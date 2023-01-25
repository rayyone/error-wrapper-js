import * as Sentry from '@sentry/react';
import {Axios, AxiosError} from 'axios';

export type AppErrType = Error | AxiosError<any>;

export interface ErrorOptions {
  shouldReport?: boolean;
  debugMessage?: string;
}

export interface ErrorConfig {
  initSentry: () => any
  getUser?: () => Promise<{ email?: string, name?: string, [key: string]: any }>
  extraSentryData?: any
}

let config: ErrorConfig

export function setup(errorConfig: ErrorConfig) {
  config = errorConfig
}

export class AppError extends Error {
  userMsg: string = '';

  message: string = ''; // just an alias for userMsg

  err: AppErrType;

  originalErrMsg: string;

  debugMsg: string;

  isAxiosErr: boolean;

  customErrCode: string | null;

  messageBag: null | { [key: string]: any };

  contexts: { [key: string]: any } | undefined;

  statusCode?: number;

  isConnectFailed?: boolean;

  constructor(
    err: AppErrType | unknown | string,
    userMessage = '',
    {debugMessage = '', shouldReport = true}: ErrorOptions = {},
  ) {
    if (!(err instanceof Axios) && !(err instanceof Error) && !(err instanceof AppError)) {
      if (typeof err === "string") {
        err = new Error(err)
        shouldReport = typeof shouldReport != undefined ? shouldReport : false // Silent error to terminate process
      } else {
        throw new Error('Wrong App Error type');
      }
    }
    super(userMessage)

    this.err = err as AppErrType;
    this.originalErrMsg = isAxiosErr(this.err) ? this.err.message : (this.err.message || '');
    this.debugMsg = debugMessage || 'Error!';
    this.isAxiosErr = isAxiosErr(this.err);
    this.customErrCode = null;
    this.messageBag = null;
    this.contexts = undefined;
    this.statusCode = isAxiosErr(this.err) ? this.err?.response?.status : 500;
    this.handleErr(userMessage, shouldReport);
  }

  handleErr = (userMessage: string, shouldReport: boolean) => {
    this.userMsg = this.originalErrMsg;
    this.isConnectFailed = this.isNetworkError(this.err);
    if (this.isConnectFailed) {
      console.log('Oops, something went wrong. Either internet connection or the called server host');
    }
    if (isAxiosErr(this.err)) {
      this.userMsg = this.err?.response?.data?.message || this.userMsg;
    }
    this.userMsg = userMessage || this.userMsg;
    this.message = this.userMsg;
    console.log('---------Debug:---------');
    console.log(this.debugMsg);
    this.printLog(this.err);
    if (this.isConnectFailed) {
      shouldReport = false;
    }
    if (shouldReport) {
      reportToSentry(this.err, this.debugMsg).then(r => r);
    }
  };

  /*
    - https://github.com/axios/axios/issues/383
    - https://github.com/axios/axios/pull/1419
  */
  isNetworkError = (error: AppErrType) => !!isAxiosErr(error) && !error.response;

  printLog = (error: AppErrType) => {
    if (isAxiosErr(error)) {
      const axiosResponse = error?.response;
      if (axiosResponse) {
        /*
         * The request was made and the server responded with a
         * status code that falls out of the range of 2xx
         */
        this.customErrCode = axiosResponse?.data.statusCode;
        this.messageBag = axiosResponse?.data.errors;
        this.contexts = axiosResponse?.data.fields;
        this.statusCode = axiosResponse?.status;
        const {url, data, method} = axiosResponse?.config || {};
        const requestInfo = {
          method,
          url,
          data,
        };
        console.log('Response headers:');
        console.log(axiosResponse?.headers);
        console.log('Response body:');
        console.log(axiosResponse?.data);
        console.log('Request info:');
        console.log(requestInfo);
        Sentry.setExtra('error_header', axiosResponse?.headers);
        Sentry.setExtra('error_data', axiosResponse?.data);
        Sentry.setExtra('request_info', requestInfo);
      } else if (error?.request) {
        /*
         * The request was made but no response was received, `error.request`
         * is an instance of XMLHttpRequest in the browser and an instance
         * of http.ClientRequest in Node.js
         */
        console.log('Axios requested but no response is returned!');
        console.log(error.request._response);
        console.log(error.request);
        Sentry.setExtra('error_request', error.request);
        Sentry.setExtra('error_request_response', error.request._response);
      }
    } else {
      console.log(error);
      Sentry.setExtra('error', error);
    }
  };
}

export async function reportToSentry(err: AppErrType, debugMsg = '') {
  if (!Sentry.getCurrentHub().getClient()) {
    await config.initSentry();
  }
  const user = await config.getUser?.()
  if (user) {
    Sentry.setUser(user);
    Sentry.setTag('email', user?.email);
  }
  Sentry.setExtra('debugMsg', debugMsg);
  if (config.extraSentryData) {
    Sentry.setExtra('extra', config.extraSentryData)
  }
  Sentry.captureException(err);
}

function isAxiosErr(anyError: AppErrType): anyError is AxiosError {
  return !!((anyError as AxiosError)?.response || (anyError as AxiosError)?.request);
}
