// navigator.mozSettings polyfill!
// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/mozSettings

// I have to define the service protocol, and this is as good place as any. The
// protocol will be as follows:
// * Each request will have a numeric request id, set by the client
// * The answers will include the request id, so the client can know to which
//   request the answer corresponds
// * The request id will also act as identifier for remote objects (locks and
//  observers!)

// createLock =>
//   * Request: { id: requestId, data: {operation: 'createLock' }}
//   * Answer:  { id: requestId, error: error}
//     (answer.error truthy means there was an error)
// Once you get an answer you can assume than the id is the identifier of the
// remote lock

// For all the operations over a lock (set and get):
//  * Request: { id: requestId,
//               data: {
//                 lockId: lockId,
//                 operation: 'set'|'get',
//                 params: [settings]
//               }
//             }
// * Answer: { id: requestId,
//             result|error: Whatever }

// For the addOBserver operation
//  Request: { id: requestId,
//             data: {
//             operation: 'addObserver',
//             settingName: setting
//           },
// Answer: Will be invoked when there's activity with the MozSettingsEvent
//  (like) object:
//    { id: requestId,
//      event: mozSettingsEvent }


(function(window) {

  'use strict';

  var NavConnectHelper = window.NavConnectHelper;
  var FakeDOMRequest = window.FakeDOMRequest;
  var OnChangeRequest = window.OnChangeRequest;

  function debug(text) {
    console.log('*-*-*- Settings PF: ' + text);
  }

  if (window.navigator.mozSettings) {
    // Hmm it's already available... so let's just use it and be done with it
    return;
  }

  // Wishful thinking at the moment...
  const SETTINGS_SERVICE = 'https://settingsservice.gaiamobile.org';

  // SettingsLock polyfill..
  function FakeSettingsLock(reqId, extraData) {

    var _resolve, _reject;
    var _lock = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    // This will hold the remote object, once the lock is actually created..
    var _lockId = null;
    _lock.then(id => _lockId = id);

    // If this is not null, all the gets and sets will return a Request that
    // will fail with the error set on _permaError
    var _permaFail = null;

    this.closed = false;

    ['set', 'get'].forEach(method => {
      this[method] = navConnHelper.methodCall.bind(navConnHelper,
                                                  {
                                                    methodName: method,
                                                    numParams: 1,
                                                    returnValue: FakeDOMRequest,
                                                    promise: _lock,
                                                    field: 'lockId'
                                                  });
    });

    this.serialize = function() {
      return {
        id: reqId,
        data: {
          operation: 'createLock'
        },
        processAnswer: function(answer) {
          if (!answer.error) {
            _resolve(answer.id);
          } else {
            _permaFail = 'Error creating lock: ' + answer.error;
            _reject(_permaFail);
          }
        }
      };
    };
  }

  // Returns a SettingsLock object to safely access settings asynchronously.
  // Note that the lock might be created and yet everything fail on it...
  var createLock = function() {
    return navConnHelper.createAndQueueRequest({}, FakeSettingsLock);
  };


  // _observers[setting][function] => undefined or an Observer object
  var _observers = {};

  function ObsererOp(operation, reqId, extraData) {
    this._id = null;
    if (operation === 'addObserver') {
      _observers[extraData.settingName][extraData.callback] = this;
    }

    this.serialize = () => {
      if (!this._id) {
        this._id = reqId;
      }
      var data = {
        operation: operation
      };

      for (var key in extraData) {
        data[key] = extraData[key];
      }

      return {
        id: this._id,
        data: data,
        processAnswer: answer => {
            extraData.callback && typeof extraData.callback === 'function' &&
              extraData.callback(answer.event);
        }
      };
    };
  }

  var Observer = ObsererOp.bind(undefined, 'addObserver');
  var ObserverRemoval = ObsererOp.bind(undefined, 'removeObserver');

  // Allows to bind a function to any change on a given settings
  var addObserver = function(setting, callback) {
    if (!_observers[setting]) {
      _observers[setting] = {};
    }

    navConnHelper.createAndQueueRequest({
                                         settingName: setting,
                                         callback: callback
                                        }, Observer);
  };

  // Allows to unbind a function previously set with addObserver.
  var removeObserver = function(setting, callback) {
    var observer = _observers[setting][callback];
    if (!observer) {
      return;
    }

    navConnHelper.createAndQueueRequest({
                                         settingName: setting,
                                         observerId: observer._id
                                        }, ObserverRemoval);
    delete _observers[setting][callback];
  };

  function execOnsettingsChange(evt) {
    this._onsettingschange && typeof this._onsettingschange == 'function' &&
      this._onsettingschange(evt);
  }

  // This will have to be a SettingsManager object...
  // Note that since mozSettings constructor is synchronous but we can't make
  // this synchronous, this has an unfortunate difference where the object might
  // disappear later.
  window.navigator.mozSettings = {
    createLock: createLock,
    addObserver: addObserver,
    removeObserver: removeObserver,
    set onsettingschange(cb) {
      this._onsettingschange = cb;
      // Avoid to send another request because it's useless
      if (this._onsettingschangeAlreadySet) {
        return;
      }
      this._onsettingschangeAlreadySet = true;
      var self = this;
      navConnHelper.createAndQueueRequest({
        operation: 'onsettingschange',
        callback: execOnsettingsChange.bind(self)
      }, OnChangeRequest);
    }
  };

  var navConnHelper = new NavConnectHelper(SETTINGS_SERVICE);

  navConnHelper.then(function(){}, e => {
    debug('Got an exception while connecting ' + e);
    window.navigator.mozSettings.createLock = null;
    window.navigator.mozSettings.addObserver = null;
    window.navigator.mozSettings.removeObserver = null;
    window.navigator.mozSettings = null;
  });

})(window);
