import { ref, pure } from '@strudel/core';
import { WidgetType, ViewPlugin, Decoration } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';

export let radioValues = {};
const getRadioID = (from) => `radio_${from}`;

export class RadioWidget extends WidgetType {
  constructor(value, options, from, to, view) {
    super();
    this.value = value;
    this.options = options;
    this.from = from;
    this.originalFrom = from;
    this.to = to;
    this.view = view;
  }

  eq() {
    return false;
  }

  toDOM() {
    let wrap = document.createElement('span');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.className = 'cm-radio';
    
    let button = wrap.appendChild(document.createElement('button'));
    button.type = 'button';
    button.textContent = String(this.value);
    button.originalValue = this.value;
    button.options = this.options;
    button.from = this.from;
    button.originalFrom = this.originalFrom;
    button.to = this.to;
    button.style = 'padding:2px 8px;margin-right:4px;cursor:pointer;border:1px solid #666;border-radius:3px;background:#333;color:#fff;font-size:11px;font-family:monospace';
    this.button = button;
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Cycle to next option
      const currentIndex = button.options.indexOf(button.originalValue);
      const nextIndex = (currentIndex + 1) % button.options.length;
      const nextValue = button.options[nextIndex];
      
      let insert = String(nextValue);
      const to = button.from + String(button.originalValue).length;
      let change = { from: button.from, to, insert };
      button.originalValue = nextValue;
      button.textContent = insert;
      this.view.dispatch({ changes: change });
      
      const id = getRadioID(button.originalFrom);
      window.postMessage({ type: 'cm-radio', value: nextValue, id });
    });
    
    return wrap;
  }

  ignoreEvent(e) {
    return true;
  }
}

export const setRadioWidgets = StateEffect.define();

export const updateRadioWidgets = (view, widgets) => {
  view.dispatch({ effects: setRadioWidgets.of(widgets) });
};

function getRadios(widgetConfigs, view) {
  return widgetConfigs
    .filter((w) => w.type === 'radio')
    .map(({ from, to, value, options }) => {
      return Decoration.widget({
        widget: new RadioWidget(value, options, from, to, view),
        side: 0,
      }).range(from);
    });
}

export const radioPlugin = ViewPlugin.fromClass(
  class {
    decorations;

    constructor(view) {
      this.decorations = Decoration.set([]);
    }

    update(update) {
      update.transactions.forEach((tr) => {
        if (tr.docChanged) {
          this.decorations = this.decorations.map(tr.changes);
          const iterator = this.decorations.iter();
          while (iterator.value) {
            if (iterator.value?.widget?.button) {
              iterator.value.widget.button.from = iterator.from;
              iterator.value.widget.button.to = iterator.to;
            }
            iterator.next();
          }
        }
        for (let e of tr.effects) {
          if (e.is(setRadioWidgets)) {
            this.decorations = Decoration.set(getRadios(e.value, update.view));
          }
        }
      });
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/**
 * Displays a radio button widget to allow the user to cycle through multiple options
 *
 * @name radio
 * @param {any} defaultValue Initial value
 * @param {...any} args Additional options to cycle through
 * @example
 * radio(0, 1, 2, 3) // cycles through 0, 1, 2, 3
 * radio("bd", "sd", "hh") // cycles through drum sounds
 */
export let radio = (defaultValue, ...args) => {
  console.warn('radio will only work when the transpiler is used... passing value as is');
  return pure(defaultValue);
};

// function transpiled from radio = (defaultValue, ...args)
export let radioWithID = (id, defaultValue, ...args) => {
  const options = [defaultValue, ...args];
  radioValues[id] = { value: defaultValue, options }; // sync state at eval time (code -> state)
  return ref(() => radioValues[id].value); // use state at query time
};

// update state when radio buttons are clicked
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data.type === 'cm-radio') {
      if (radioValues[e.data.id] !== undefined) {
        // update state when radio is clicked
        radioValues[e.data.id].value = e.data.value;
      } else {
        console.warn(`radio with id "${e.data.id}" is not registered. Only ${Object.keys(radioValues)}`);
      }
    }
  });
}
