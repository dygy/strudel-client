import { ref, pure } from '@strudel/core';
import { WidgetType, ViewPlugin, Decoration } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';

export let toggleValues = {};
const getToggleID = (from) => `toggle_${from}`;

export class ToggleWidget extends WidgetType {
  constructor(value, from, to, view) {
    super();
    this.value = value;
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
    wrap.className = 'cm-toggle';
    let toggle = wrap.appendChild(document.createElement('input'));
    toggle.type = 'range';
    toggle.min = 0;
    toggle.max = 1;
    toggle.step = 1;
    toggle.originalValue = this.value;
    toggle.value = toggle.originalValue;
    toggle.from = this.from;
    toggle.originalFrom = this.originalFrom;
    toggle.to = this.to;
    toggle.style = 'width:64px;margin-right:4px;transform:translateY(4px);cursor:pointer';
    this.toggle = toggle;
    
    toggle.addEventListener('click', (e) => {
      // Toggle between 0 and 1
      const currentValue = Number(toggle.originalValue);
      const next = currentValue === 0 ? 1 : 0;
      let insert = String(next);
      const to = toggle.from + toggle.originalValue.length;
      let change = { from: toggle.from, to, insert };
      toggle.originalValue = insert;
      toggle.value = insert;
      this.view.dispatch({ changes: change });
      const id = getToggleID(toggle.originalFrom);
      window.postMessage({ type: 'cm-toggle', value: next, id });
    });
    
    return wrap;
  }

  ignoreEvent(e) {
    return true;
  }
}

export const setToggleWidgets = StateEffect.define();

export const updateToggleWidgets = (view, widgets) => {
  view.dispatch({ effects: setToggleWidgets.of(widgets) });
};

function getToggles(widgetConfigs, view) {
  return widgetConfigs
    .filter((w) => w.type === 'toggle')
    .map(({ from, to, value }) => {
      return Decoration.widget({
        widget: new ToggleWidget(value, from, to, view),
        side: 0,
      }).range(from);
    });
}

export const togglePlugin = ViewPlugin.fromClass(
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
            if (iterator.value?.widget?.toggle) {
              iterator.value.widget.toggle.from = iterator.from;
              iterator.value.widget.toggle.to = iterator.to;
            }
            iterator.next();
          }
        }
        for (let e of tr.effects) {
          if (e.is(setToggleWidgets)) {
            this.decorations = Decoration.set(getToggles(e.value, update.view));
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
 * Displays a toggle widget to allow the user switch between 0 and 1
 *
 * @name toggle
 * @param {number} value Initial value (0 or 1)
 */
export let toggle = (value) => {
  console.warn('toggle will only work when the transpiler is used... passing value as is');
  return pure(value);
};

// function transpiled from toggle = (value)
export let toggleWithID = (id, value) => {
  toggleValues[id] = value; // sync state at eval time (code -> state)
  return ref(() => toggleValues[id]); // use state at query time
};

// update state when toggles are clicked
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    if (e.data.type === 'cm-toggle') {
      if (toggleValues[e.data.id] !== undefined) {
        // update state when toggle is clicked
        toggleValues[e.data.id] = e.data.value;
      } else {
        console.warn(`toggle with id "${e.data.id}" is not registered. Only ${Object.keys(toggleValues)}`);
      }
    }
  });
}
