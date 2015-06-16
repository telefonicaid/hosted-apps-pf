(function(window) {

  'use strict';


  // Helper for the common tasks for navigator.connect. This is not strictly
  // needed, but helps to do the things always the same way. That way being:
  // * The client app creates one (or as many as it needs) NavConnectHelper
  //   objects. Each NavConnectHelèr object is a promise that will fulfill when
  //   the connection is established.
  // * The fulfilled promise has an object that (so far) has only one method:
  //     * sendObject: Sends an object to the connected Service Worker. The
  //     object sent needs to implement a serialize method. The serialize method
  //     will return an object with:
  //       * id: a unique id for the object
  //       * data: A cloneable/transferrable object with the data that must be
  //         sent to the Worker.
  //       * processAnswer: A callback that will be called whenever there is
  //         an answer for this petition. Note that this callback can be
  //         executed  0-n times, depending on what the service is expected to
  //         do.
  function NavConnectHelper(serviceURL) {

    function debug(text) {
      console.log('*-*-* NavConnectHelper: ' + text);
    }

    // It actually makesmore sense having this here...
    var _currentRequestId = 1;

    var retValue = new Promise((resolve, reject) => {
      // navigator.connect port with the settings service, when the connection
      // is established.
      var _port = null;

      var _messageHandlers = {};

      var _getHandler = function(evt) {
        return evt && evt.data && _messageHandlers[evt.data.id] &&
          typeof _messageHandlers[evt.data.id] == 'function' &&
          _messageHandlers[evt.data.id];
      };

      navigator.connect(serviceURL).then(port => {
        debug('Successfully established connection to ' + serviceURL);
        _port = port;
        port.onmessage = function (evt) {
          var handler = _getHandler(evt);
          if (!handler) {
            debug('Huh? Got an message with ' + JSON.stringify(evt.data) +
                  ' that I don\'t know what to do with. Discarding!');
            return;
          }
          handler(evt.data);
        };

        var realHandler = {
          // aObject MUSTt implement a serialize method, and the serialize
          // method MUST return an object with the following structure:
          //  {
          //    id: A numeric identifier for this operation
          //    data: Some extra data that the server will need
          //    processAnswer: a function that will process the answer for this
          //    message
          // }
          sendObject: function(aObject) {
            var serialized = aObject.serialize();
            _messageHandlers[serialized.id] = serialized.processAnswer;
            _port.postMessage({id: serialized.id, data: serialized.data});
          }
        };

        resolve(realHandler);
      }).catch(error => reject(error));
    });

    retValue.createAndQueueRequest = function(data, constructor) {
      return this.queueDependentRequest(data, constructor);
    };

    // Sent a request that depends on another promise (for things that
    // require a previous object, like setttings locks or sockets).
    // Basically, waits till 'promise' is fulfilled, set the result as the
    // 'field' field of 'data', and calls sendObject with that object.
    retValue.queueDependentRequest = function(data, constructor, promise,
                                              field) {
      var request = new constructor(++_currentRequestId, data);
      Promise.all([this, promise]).then(([navConn, promValue]) => {
        if (field && promValue) {
          data[field] = promValue;
        }
        navConn.sendObject(request);
      });
      return request;
    };

    retValue.methodCall = function(options) {
      var methodName = options.methodName;
      var numParams = options.numParams;
      var returnValue = options.returnValue;
      var extraData = options.extraData || {};
      var params = [];
      // It's not recommended calling splice on arguments apparently.
      // Also, first three arguments are explicit
      for(var i = 1; i < numParams + 1; i++) {
        params.push(arguments[i]);
      }
      var data = {
        operation: methodName,
        params: params
      };

      for (var key in extraData) {
        data[key] = extraData[key];
      }

      return this.queueDependentRequest(data,
        returnValue, options.promise, options.field);
    };

    return retValue;
  }

  // This should probably be on a common part...
  // Implements something like
  // http://mxr.mozilla.org/mozilla-central/source/dom/base/nsIDOMDOMRequest.idl
  // Well, *expletive removed* me sideways, now DOMRequests are promises also!
  function FakeDOMRequest(reqId, extraData) {
    var _result = null;
    var _error = null;
    var _fired = false;
    var _resolve, _reject;
    var internalPromise = new Promise((resolve, reject) => {
      _resolve = resolve;
      _reject = reject;
    });

    var self = this;
    this.data = extraData;
    this.serialize = function() {
      return {
        id: reqId,
        data: extraData,
        processAnswer: function(answer) {
          if (answer.error) {
            self._fireError((typeof answer.error === 'object') ?
                             answer.error :
                             JSON.parse(answer.error));
          } else {
            self._fireSuccess(answer.result);
          }
        }
      };
    };

    this.then = function (cbresolve, cbreject) {
      return internalPromise.then(cbresolve, cbreject);
    };

    Object.defineProperty(this, 'result', {
      get: function() {
        return _result;
      },
      set: function(v) {
        _result = v;
      }
    });

    Object.defineProperty(this, 'error', {
      get: function() {
        return _error;
      },
      set: function(e) {
        _error = e;
      }
    });

    this._fireSuccess = function(result) {
      if (!_fired) {
        _result = result;
        _fired = true;
        _resolve(result);
        this.onsuccess &&
          typeof this.onsuccess === 'function' &&
          this.onsuccess({target: this});
      }
    };

    this._fireError = function(error) {
      if (!_fired) {
        _error = error;
        _fired = true;
        _reject(error);
        this.onerror
          && typeof this.onerror === 'function' && this.onerror(error);
      }
    };
  }

  // Implements something like
  // http://mxr.mozilla.org/mozilla-central/source/dom/base/nsIDOMDOMCursor.idl
  // FIX-ME: Note that this implementation expects the remote side to serialize
  // all the cursor content to send it back on one single answer. This is
  // suboptimal if the cursor holds a lot of data (like for SMS...).
  function FakeDOMCursorRequest(reqId, extraData) {
    FakeDOMRequest.call(this, reqId, extraData);
    var _done = false;
    var _serializedData = null;
    var _cursor = 0;

    var self = this;
    this.serialize = function() {
      return {
        id: reqId,
        data: extraData,
        processAnswer: function(answer) {
          if (answer.error) {
            self._fireError(answer.error);
          } else {
            _serializedData = answer.result;
            self.continue();
          }
        }
      };
    };

    this.then = undefined;

    Object.defineProperty(this, 'done', {
      get: function() {
        return _done;
      }
    });

    this.continue = function() {
      if (!_done) {
        this.result = _serializedData[_cursor];
        this._fireSuccess();
      }
    };

    // To-do: We should not need to rewrite this
    this._fireSuccess = function() {
      if (!_done) {
        _cursor++;
        _done = _cursor > _serializedData.length ? true : false;
        this.onsuccess &&
          typeof this.onsuccess === 'function' &&
          this.onsuccess({target: this});
      }
    };

    this._fireError = function(aError) {
      if (!_done) {
        this.error = aError;
        this.onerror
          && typeof this.onerror === 'function' && this.onerror(aError);
      }
    };
  }

  function FakeEventTarget(navConnHelper, listenerCb, field, promise) {
    // _listeners[type][ListenerId] => undefined or a callback function
    var _listeners = {};
    promise = promise || Promise.resolve(null);

    // And this is something else that might be reusable...
    function Listener(reqId, extraData) {
      _listeners[extraData.type][reqId] = extraData.cb;
      this.serialize = function() {
        return {
          id: reqId,
          data: extraData,
          processAnswer: answer => {
            if (answer.event) {
              if (typeof listenerCb === 'function') {
                listenerCb(answer.event, _listeners[extraData.type][reqId]);
              } else {
                _listeners[extraData.type] &&
                  typeof _listeners[extraData.type][reqId] === 'function' &&
                  _listeners[extraData.type][reqId](answer.event);
              }
            }
          }
        };
      };
    }

    function ListenerRemoval(reqId, extraData) {
      this.serialize = function() {
        return {
          id: reqId,
          data: extraData,
          processAnswer: answer => debug('Got an invalid answer for: ' + reqId)
        };
      };
    }

    function Dispatcher(reqId, extraData) {
      this.serialize = function() {
        return {
          id: reqId,
          data: extraData,
          processAnswer: answer => debug('Got an invalid answer for: ' + reqId)
        };
      };
    }

    this.addEventListener = function(type, cb, useCapture) {
      if (!_listeners[type]) {
        _listeners[type] = {};
      }
      promise.then(value => {
        var data = {
          operation: 'addEventListener',
          type: type,
          useCapture: useCapture,
          cb: cb
        };

        data[field] = value;
        navConnHelper.createAndQueueRequest(data, Listener);
      });
    };

    this.removeEventListener = function(type, cb) {
      var listeners = _listeners[type];
      var listenerId = -1;
      for (var key in listeners) {
        if (listeners[key] === cb) {
          listenerId = key;
          break;
        }
      }

      if (cbIndex === -1) {
        return;
      }

      promise.then(value => {
        var data = {
          operation: 'removeEventListener',
          type: type,
          listenerId: listenerId
        };

        data[field] = value;
        navConnHelper.createAndQueueRequest(data, ListenerRemoval);
      });
      delete _listeners[type][listenerId];
    };

    this.dispatchEvent = function(event) {
      promise.then(value => {
        var data = {
          operation: 'dispatchEvent',
          event: event
        };

        data[field] = value;
        navConnHelper.createAndQueueRequest(data, Dispatcher);
      });
    };
  }

  function HandlerSetRequest(reqId, extraData) {
    this.serialize = function() {
      return {
        id: reqId,
        data: {
          operation: extraData.handler,
          socketId: extraData.socketId
        },
        processAnswer: answer => extraData.cb(answer.event)
      };
    };
  }

  function VoidRequest(reqId, extraData) {
    function debug(text) {
      console.log('*-*-* VoidRequest: ' + text);
    }
    this.serialize = function() {
      return {
        id: reqId,
        data: extraData,
        processAnswer: answer => debug('Got an invalid answer for: ' + reqId)
      };
    };
  }

  function OnChangeRequest(reqId, extraData) {
    this.serialize = () => {
      return {
        id: reqId,
        data: extraData,
        processAnswer: answer => {
          if (answer.event) {
            extraData.callback(answer.event);
          }
        }
      };
    };
  }

  window.VoidRequest = VoidRequest;
  window.OnChangeRequest = OnChangeRequest;
  window.HandlerSetRequest = HandlerSetRequest;
  window.NavConnectHelper = NavConnectHelper;
  window.FakeDOMRequest = FakeDOMRequest;
  window.FakeDOMCursorRequest = FakeDOMCursorRequest;
  window.FakeEventTarget = FakeEventTarget;

})(window);
