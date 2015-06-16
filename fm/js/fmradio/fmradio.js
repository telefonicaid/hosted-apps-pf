// navigator.mozFMRadio polyfill!
// https://developer.mozilla.org/es/docs/Web/API/Navigator/mozFMRadio

// I have to define the service protocol, and this is as good place as any. The
// protocol will be as follows:
// * Each request will have a numeric request id, set by the client
// * The answers will include the request id, so the client can know to which
//   request the answer corresponds

// For all the operations:
//  * Request: { id: requestId,
//               data: {
//                 operation: methodName,
//                 params: parameters (optional)
//               }
//             }
// * Answer: { id: requestId,
//             result|error: Whatever }

// For the onpropertychange operations
//  Request: { id: requestId,
//             data: {
//             operation: desiredPropertyChange,
//             property: propertyToUpdatedWhenTriggered
//           },
// Answer:
//    { id: requestId,
//      data: {
//        event: {
//          type: desiredPropertyChange,
//          property: propertyName,
//          propertyValue: newValueOfTheProperty
//        }
//      }
//    }


(function(window) {

  function debug(text) {
    console.log('*-*-*- FMRadio PF: ' + text);
  }

  if (window.navigator.mozFMRadio) {
    // Hmm it's already available... so let's just use it and be done with it
    return;
  }

  var FakeDOMRequest = window.FakeDOMRequest;
  var OnChangeRequest = window.OnChangeRequest;

  // Wishful thinking at the moment...
  const FMRADIO_SERVICE = 'https://fmradioservice.gaiamobile.org';

  var capitalize = function(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  function FakeFMRadio() {
    this.fakeEnabled = false;

    this.fakeAntennaAvailable = false;

    this.fakeFrequencyLowerBound = 87.5;

    this.fakeFrequencyUpperBound = 108;

    this.fakeChannelWidth = 0.1;

    var self = this;

    function FMRadioRequest(reqId, extraData) {
      this.serialize = function() {
        return {
          id: reqId,
          data: extraData,
          processAnswer: answer => {
            if (answer.error) {
              console.error(answer.error);
            } else {
              self['_' + answer.result.name] = answer.result.value;
              // This is a trick beacuse the current frequency could be null if the
              // radio is not enabled and we need to draw the UI with an initial
              // frequency
              if (answer.result.name === 'frequency' &&
                answer.result.value === null) {
                  self['_' + answer.result.name] = self.frequencyLowerBound;
              }

              var onchange = '_on' + answer.result.name.toLowerCase() + 'change';
              // Trigger callback in order to force the update of the
              // property value
              if (typeof self[onchange] === 'function') {
                self[onchange]({
                  name: 'on' + answer.result.name.toLowerCase() + 'change',
                  value: answer.result.value
                });
              }
            }
          }
        };
      };
    }

    this.disable = function fm_disable() {
      return navConnPromise.createAndQueueRequest({
        operation: 'disable'
      }, FakeDOMRequest);
    };

    this.enable = function fm_enable(frequency) {
      return navConnPromise.createAndQueueRequest({
        operation: 'enable',
        params: [frequency]
      }, FakeDOMRequest);
    };

    this.seekUp = function fm_seekUp() {
      return navConnPromise.createAndQueueRequest({
        operation: 'seekUp'
      }, FakeDOMRequest);
    };

    this.seekDown = function fm_seekDown() {
      return navConnPromise.createAndQueueRequest({
        operation: 'seekDown'
      }, FakeDOMRequest);
    };

    this.cancelSeek = function fm_cancelSeek() {
      return navConnPromise.createAndQueueRequest({
        operation: 'cancelSeek'
      }, FakeDOMRequest);
    };

    this.setFrequency = function fm_setFrequency(freq) {
      return navConnPromise.createAndQueueRequest({
        operation: 'setFrequency',
        params: [freq]
      }, FakeDOMRequest);
    };

    var properties = ['enabled', 'antennaAvailable', 'frequencyUpperBound',
      'frequencyLowerBound', 'channelWidth', 'frequency'];

    properties.forEach(property => {
      Object.defineProperty(this, property, {
        get: function () {
          // Enabled value should be updated
          var realValue = this['_' + property];
          if (typeof realValue !== 'undefined' && realValue !== null) {
              return realValue;
          }

          if (property === 'frequency') {
            // Let's assume that we're in the lower bound frequency
            // This is a trick beacuse the current frequency could be null if
            // the radio is not enabled and we need to draw the UI with an
            // initial frequency
            this['_' + property] = this.fakeFrequencyLowerBound;
            this['fake' + capitalize(property)] = this.fakeFrequencyLowerBound;
          }

          navConnPromise.createAndQueueRequest({
            operation: 'get',
            params: [property]
          }, FMRadioRequest);

          return this['fake' + capitalize(property)];
        }
      });
    });

    function execOnChange(changeType, event) {
      this['_' + event.property] = event.propertyValue;
      var cb = '_on' + changeType;
      this[cb] && typeof this[cb] === 'function' && this[cb](event);
    }

    this._onchange = function(changeType, property, cb) {
      this['_on' + changeType] = cb;
      if (this['_on' + changeType + 'AlreadySet']) {
        return;
      }
      // Avoid to send another request because it's useless
      this['_on' + changeType + 'AlreadySet'] = true;

      navConnPromise.createAndQueueRequest({
        operation: 'on' + changeType,
        property: property,
        callback: execOnChange.bind(self, changeType)
      }, OnChangeRequest);
    };

    var onChangeEvents = [
      {eventType: 'frequencychange', property: 'frequency'},
      {eventType: 'enabled', property: 'enabled'},
      {eventType: 'disabled', property: 'enabled'},
      {eventType: 'antennaavailablechange', property: 'antennaAvailable'}
    ];

    onChangeEvents.forEach(changeEvent => {
      Object.defineProperty(this, 'on' + changeEvent.eventType, {
        set: function(cb) {
          this._onchange(changeEvent.eventType, changeEvent.property, cb);
        }
      });
    });
  }

  window.navigator.mozFMRadio = new FakeFMRadio();


  /** POLYFILL PART **/
  var navConnPromise = new NavConnectHelper(FMRADIO_SERVICE);

  navConnPromise.then(function(){}, e => {
    debug('Got an exception while connecting ' + e);
    window.navigator.mozFMRadio = null;
  });

})(window);
