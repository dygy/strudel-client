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
    wrap.style = 'display:inline-flex;gap:4px;margin:0 6px;align-items:center;vertical-align:middle;transform:translateY(-1px)';
    
    // Create a button for each option
    this.options.forEach((option) => {
      let button = wrap.appendChild(document.createElement('button'));
      button.type = 'button';
      button.textContent = String(option);
      button.optionValue = option;
      button.originalValue = this.value;
      button.options = this.options;
      button.from = this.from;
      button.originalFrom = this.originalFrom;
      button.to = this.to;
      
      // Style based on whether this option is selected
      const isSelected = String(option) === String(this.value);
      const getButtonStyle = (selected, hover = false) => {
        const bg = selected ? '#4a9eff' : (hover ? '#444' : '#2a2a2a');
        const border = selected ? '#4a9eff' : '#555';
        const shadow = selected ? '0 0 0 2px rgba(74, 158, 255, 0.2)' : 'none';
        return `padding:4px 10px;cursor:pointer;border:1px solid ${border};border-radius:6px;background:${bg};color:#fff;font-size:11px;font-family:monospace;transition:all 0.15s ease;box-shadow:${shadow};font-weight:${selected ? '600' : '400'};min-width:32px;text-align:center`;
      };
      
      button.style = getButtonStyle(isSelected);
      
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const selectedValue = button.optionValue;
        let insert = String(selectedValue);
        const to = button.from + String(button.originalValue).length;
        let change = { from: button.from, to, insert };
        
        // Update all buttons in this group
        Array.from(wrap.children).forEach((btn) => {
          const btnIsSelected = String(btn.optionValue) === String(selectedValue);
          btn.style = getButtonStyle(btnIsSelected);
          btn.originalValue = selectedValue;
        });
        
        this.view.dispatch({ changes: change });
        
        const id = getRadioID(button.originalFrom);
        window.postMessage({ type: 'cm-radio', value: selectedValue, id });
      });
      
      button.addEventListener('mouseenter', () => {
        const isSelected = String(button.optionValue) === String(button.originalValue);
        button.style = getButtonStyle(isSelected, !isSelected);
      });
      
      button.addEventListener('mouseleave', () => {
        const isSelected = String(button.optionValue) === String(button.originalValue);
        button.style = getButtonStyle(isSelected, false);
      });
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
