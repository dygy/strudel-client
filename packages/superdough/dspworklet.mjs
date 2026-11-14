import { getAudioContext } from './audioContext.mjs';
import { getSuperdoughAudioController } from './superdough.mjs'; // fork: route .dough() through the output chain

let worklet;
export async function dspWorklet(ac, code) {
  const name = `dsp-worklet-${Date.now()}`;
  const workletCode = `${code}
let __q = []; // trigger queue
class MyProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.t = 0;
    this.stopped = false;
    this.port.onmessage = (e) => {
      if(e.data==='stop') {
        this.stopped = true;
      } else if(e.data?.dough) {
        __q.push(e.data)
      } else {
        msg?.(e.data)
      }
    };
  }
  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if(__q.length) {
      for(let i=0;i<__q.length;++i) {
        const deadline = __q[i].time-currentTime;
        if(deadline<=0) {
          trigger(__q[i].dough)
          __q.splice(i,1)
        }
      }
    }
    for (let i = 0; i < output[0].length; i++) {
      const out = dsp(this.t / sampleRate);
      output.forEach((channel) => {
        channel[i] = out;
      });
      this.t++;
    }
  return !this.stopped;
  }
}
registerProcessor('${name}', MyProcessor);
`;
  const base64String = btoa(workletCode);
  const dataURL = `data:text/javascript;base64,${base64String}`;
  await ac.audioWorklet.addModule(dataURL);
  const node = new AudioWorkletNode(ac, name);
  const stop = () => node.port.postMessage('stop');
  return { node, stop };
}
// fork (strudel-client): the controller the running worklet plays into, or null (ac.destination).
let workletOutput = null;

const stop = () => {
  if (worklet) {
    worklet?.stop();
    workletOutput?.disconnectDirectInput(worklet.node); // fork: forget it, so reset() does not re-attach it
    workletOutput = null;
    worklet?.node?.disconnect();
  }
};

/**
 * fork (strudel-client): play the worklet into superdough's destinationGain, so `.dough()` goes
 * through the same gain, recorders' tap and output insert (the main EQ, its limiter and its 6 ms
 * look-ahead delay) as superdough's sounds. Upstream connects it to ac.destination, which is still
 * the fallback when there is no controller on this context.
 */
function connectWorkletOutput(node, ac) {
  let controller = null;
  try {
    controller = getSuperdoughAudioController();
  } catch {
    controller = null;
  }
  if (controller?.audioContext === ac && typeof controller.connectDirectInput === 'function') {
    controller.connectDirectInput(node);
    return controller;
  }
  node.connect(ac.destination);
  return null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data === 'strudel-stop') {
      stop();
    } else if (e.data?.dough) {
      worklet?.node.port.postMessage(e.data);
    }
  });
}

export const dough = async (code) => {
  const ac = getAudioContext();
  stop();
  worklet = await dspWorklet(ac, code);
  workletOutput = connectWorkletOutput(worklet.node, ac); // fork: was worklet.node.connect(ac.destination)
};

export function doughTrigger(hap, currentTime, cps, targetTime) {
  window.postMessage({ time: targetTime, dough: hap.value, currentTime, duration: hap.duration, cps });
}
