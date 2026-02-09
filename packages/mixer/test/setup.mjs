/**
 * Test setup for @strudel/mixer
 * 
 * Provides mock Web Audio API for testing in Node environment
 */

// Mock AudioWorkletProcessor for superdough
if (typeof AudioWorkletProcessor === 'undefined') {
  global.AudioWorkletProcessor = class MockAudioWorkletProcessor {
    constructor(options) {
      this.port = {
        postMessage: () => {},
        onmessage: null,
      };
    }
    process() {
      return true;
    }
  };
  
  global.registerProcessor = () => {};
}

// Mock AudioContext for testing
if (typeof AudioContext === 'undefined') {
  global.AudioContext = class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.destination = {
        channelCount: 2,
      };
    }

    createGain() {
      return {
        gain: { value: 1.0, setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, cancelScheduledValues: () => {} },
        connect: () => {},
        disconnect: () => {},
      };
    }

    createMediaStreamDestination() {
      return {
        stream: new MediaStream(),
        channelCount: 2,
      };
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      return Promise.resolve();
    }
  };
}

// Mock MediaStream
if (typeof MediaStream === 'undefined') {
  global.MediaStream = class MockMediaStream {
    constructor() {
      this.id = Math.random().toString(36);
    }
  };
}

// Mock Audio element
if (typeof Audio === 'undefined') {
  global.Audio = class MockAudio {
    constructor() {
      this.srcObject = null;
    }

    setSinkId(deviceId) {
      return Promise.resolve();
    }

    play() {
      return Promise.resolve();
    }

    pause() {}
  };
}

// Mock navigator.mediaDevices
if (typeof navigator === 'undefined') {
  global.navigator = {};
}

if (!navigator.mediaDevices) {
  navigator.mediaDevices = {
    enumerateDevices: () => Promise.resolve([
      { deviceId: 'default', kind: 'audiooutput', label: 'Default' },
      { deviceId: 'device1', kind: 'audiooutput', label: 'Speakers' },
      { deviceId: 'device2', kind: 'audiooutput', label: 'Headphones' },
    ]),
  };
}

// Mock localStorage
if (typeof localStorage === 'undefined') {
  const store = {};
  global.localStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(key => delete store[key]); },
  };
}

// Mock window for event dispatching
if (typeof window === 'undefined') {
  global.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
}

// Mock CustomEvent
if (typeof CustomEvent === 'undefined') {
  global.CustomEvent = class MockCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
}
