// DeviceStorage polyfill!
// https://developer.mozilla.org/en-US/docs/Web/API/Device_Storage_API

// I have to define the service protocol, and this is as good place as any. The
// protocol will be as follows:
// * Each request will have a numeric request id, set by the client
// * The answers will include the request id, so the client can know to which
//   request the answer corresponds
// * The request id will also act as identifier for remote objects
// (deviceStorage)

// For all the operations over a DeviceStorage object:
//  * Request: { id: requestId,
//               data: {
//                 operation: methodName,
//                 params: params,
//                 deviceStorageId: deviceStorageId,
//                                  (only non getStorageDevice operation)
//                 storageName: storageName (only getStorageDevice operation)
//               }
//             }
// * Answer: { id: requestId,
//             result|error: Whatever }

// For the onchange operation
//  Request: { id: requestId,
//             data: {
//             operation: 'onchange'
//           },
// Answer: Will be invoked when there's activity with
// the DeviceStorageChangeEvent (like) object:
//    { id: requestId,
//      data: DeviceStorageChangeEvent }

// For the EventTarget operations
//  Request: { id: requestId,
//             data: {
//             operation: 'addEventListener|removeEventListener|dispatchEvent',
//             type: eventType (only addEventListener and removeEventListener),
//             useCapture: true|false (only addEventListener),
//             event: eventToDispatch (only dispatchEvent)
//           },
// Answer: When invoked:
//    { id: requestId,
//      event: EventTargetEvent }
'use strict';

/* globals FakeDOMRequest, FakeDOMCursorRequest, NavConnectHelper */

(function(window) {

  function debug(text) {
    console.log('*-*-*- DeviceStorage PF: ' + text);
  }

  var realGetDeviceStorage = navigator.getDeviceStorage.bind(navigator);
  var realGetDeviceStorages = navigator.getDeviceStorages.bind(navigator);
  var FakeDOMRequest = window.FakeDOMRequest;
  var OnChangeRequest = window.OnChangeRequest;

  // Wishful thinking at the moment...
  const DEVICESTORAGE_SERVICE = 'https://devicestorageservice.gaiamobile.org';

  var _deviceStorageAttributes = ['canBeFormatted', 'canBeMounted',
    'canBeShared', 'default', 'isRemovable', 'storageName'];

  // DeviceStorage polyfill..
  function FakeDeviceStorage(reqId, extraData) {

    var _resolve, _reject;
    var _deviceStorage = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    // This will hold the remote object,
    // once the DeviceStorage is actually created..
    var _deviceStorageId = null;
    _deviceStorage.then(id => _deviceStorageId = id);

    // realDeviceStorage object can't be used without permissions
    _deviceStorageAttributes.forEach(attr => {
      this[attr] = extraData.realDeviceStorage[attr];
    });

    FakeEventTarget.call(this, navConnHelper, null, 'deviceStorageId',
      _deviceStorage);

    [{
      method: 'add',
      numParams: 1
    },
    {
      method: 'addNamed',
      numParams: 2
    },
    {
      method: 'available',
      numParams: 0
    },
    {
      method: 'delete',
      numParams: 1
    },
    {
      method: 'freeSpace',
      numParams: 0
    },
    {
      method: 'get',
      numParams: 1
    },
    {
      method: 'getEditable',
      numParams: 1
    },
    {
      method: 'usedSpace',
      numParams: 0
    },
    {
      method: 'enumerate',
      returnValue: FakeDOMCursorRequest,
      numParams: 2
    },
    {
      method: 'enumerateEditable',
      returnValue: FakeDOMCursorRequest,
      numParams: 2
    }].forEach(methodInfo => {
      this[methodInfo.method] = navConnHelper.methodCall.bind(navConnHelper,
        {
          methodName: methodInfo.method,
          numParams: methodInfo.numParams,
          returnValue: methodInfo.returnValue || FakeDOMRequest,
          promise: _deviceStorage,
          field: 'deviceStorageId'
        });
    });

    function execOnChange(evt) {
      this._onchange && typeof this._onchange === 'function' &&
        this._onchange(evt);
    }

    Object.defineProperty(this, 'onchange', {
      set: function(cb) {
        this._onchange = cb;
        // Avoid to send another request because it's useless
        if (this._onchangeAlreadySet) {
          return;
        }
        this._onchangeAlreadySet = true;
        var self = this;
        navConnHelper.methodCall({
                                  methodName: 'onchange',
                                  numParams: 0,
                                  returnValue: OnChangeRequest,
                                  extraData: {
                                    callback: execOnChange.bind(self)
                                  },
                                  promise: _deviceStorage,
                                  field: 'deviceStorageId'
                                });
      }
    });

    this.serialize = function() {
      var self = this;
      return {
        id: reqId,
        data: {
          operation: 'getDeviceStorage',
          params: [extraData.type],
          storageName: self.storageName
        },
        processAnswer: function(answer) {
          if (!answer.error) {
            _resolve(answer.id);
          } else {
            _reject(answer.error);
          }
        }
      };
    };
  }

  // Returns a DeviceStorage object to safely access a storage area
  var getDeviceStorageCustom = function(type) {
    return navConnHelper.createAndQueueRequest({
        type: type,
        realDeviceStorage: realGetDeviceStorage(type)
      }, FakeDeviceStorage);
  };

  var getDeviceStoragesCustom = function(type) {
    var realDeviceStorages = realGetDeviceStorages(type);
    var fakeDeviceStorages = [];

    realDeviceStorages.forEach(realDeviceStorage => {
      var deviceStorage = navConnHelper.createAndQueueRequest({
          type: type,
          realDeviceStorage: realGetDeviceStorage(type)
        }, FakeDeviceStorage);
      fakeDeviceStorages.push(deviceStorage);
    });

    return fakeDeviceStorages;
  };

  // We should avoid the client from accessing the real api
  navigator.getDeviceStorage = getDeviceStorageCustom;
  navigator.getDeviceStorages = getDeviceStoragesCustom;

  var navConnHelper = new NavConnectHelper(DEVICESTORAGE_SERVICE);

  navConnHelper.then(function(){}, e => {
    debug('Got an exception while connecting ' + e);
    window.navigator.getDeviceStorage = realGetDeviceStorage;
    window.navigator.getDeviceStorages = realGetDeviceStorages;
  });

})(window);
