/**
 * rapi-avatar/float
 *
 * ラピ drawn in a window of her own on the desktop, above the header and the
 * in-app browser (#1535), and what she needs to know about the main window.
 */
export { RapiFloatBridge } from './RapiFloatBridge';
export { RapiFloatPage } from './RapiFloatPage';
export {
  RapiEnvironmentProvider,
  useRapiEnvironment,
  useRapiLocation,
  type RapiEnvironment,
} from './rapi-environment';
export { isTauriDesktop, RAPI_FLOAT_ROUTE } from './rapi-float-protocol';
