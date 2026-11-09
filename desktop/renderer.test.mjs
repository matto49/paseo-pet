import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("./renderer.js", import.meta.url), "utf8");

function fixture(t) {
  let receive;
  const opened = [];
  const classes = new Set();
  const attrs = new Map();
  class PetSprite {
    constructor() {
      this.ac = new AbortController();
      this.dragState = { active: false, dragging: false };
      this.bubble = {
        classList: {
          contains: (v) => classes.has(v),
          add: (...x) =>
            x.forEach((v) => {
              classes.add(v);
            }),
          remove: (...x) =>
            x.forEach((v) => {
              classes.delete(v);
            }),
        },
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
        addEventListener() {},
        textContent: "",
      };
      this.workText = "任务 A";
      this.workState = "working";
      this.bindEvents();
    }
    bindEvents() {}
    dispose() {}
    stopThrow() {}
    stopMove() {}
    syncInputBusy() {}
    onClick() {
      this.normalClick = true;
    }
    renderBubble() {
      this.bubbleSlot = "work";
      this.bubble.textContent = this.workText;
    }
    workClickable() {
      return false;
    }
    openWorkSession() {
      throw new Error("DSH navigation must not run for Paseo");
    }
  }
  runInNewContext(source, {
    PetSprite,
    clearTimeout,
    setTimeout,
    Date,
    window: {
      paseoPetBridge: {
        subscribe: (fn) => {
          receive = fn;
        },
        open: (url) => {
          opened.push(url);
        },
      },
    },
  });
  const sprite = new PetSprite();
  t.after(() => sprite.dispose());
  return { sprite, receive: (v) => receive(v), opened, attrs, classes };
}
const homeUrl = "http://localhost:8081/";
const urlA = `${homeUrl}h/host/agent/a`;
const urlB = `${homeUrl}h/host/agent/b`;
const status = {
  enabled: true,
  homeUrl,
  work: { task: "任务 A", state: "working", url: urlA },
  notification: null,
};
const click = (detail) => ({ detail, preventDefault() {}, stopPropagation() {} });

test("double click opens the web home; single clicks and dragging retain their behavior", (t) => {
  const f = fixture(t);
  f.receive(status);
  f.sprite.onClick(click(1));
  assert.equal(f.sprite.normalClick, true);
  assert.deepEqual(f.opened, []);
  f.sprite.onClick(click(2));
  assert.deepEqual(f.opened, [homeUrl]);
  f.sprite.justDragged = true;
  f.sprite.onClick(click(2));
  assert.equal(f.opened.length, 1);
});

test("work bubbles navigate only when their displayed text and state match", (t) => {
  const f = fixture(t);
  f.receive(status);
  assert.equal(f.attrs.get("role"), "link");
  f.sprite.openWorkSession();
  assert.deepEqual(f.opened, [urlA]);
  f.sprite.workText = "其他任务";
  f.sprite.renderBubble();
  assert.equal(f.sprite.paseoBubbleUrl, null);
  assert.equal(f.attrs.has("role"), false);
});

test("a notification keeps its producing session after another task takes over", (t) => {
  const f = fixture(t);
  f.receive({
    ...status,
    notification: { id: 1, text: "A 完成", url: urlA, expiresAt: Date.now() + 10000 },
  });
  f.sprite.workText = "任务 B";
  f.receive({ ...status, work: { task: "任务 B", state: "working", url: urlB } });
  assert.equal(f.sprite.bubble.textContent, "A 完成");
  f.sprite.openWorkSession();
  assert.deepEqual(f.opened, [urlA]);
  assert.equal(Object.isFrozen(f.sprite.paseoNotification), true);
});

test("expired notifications never replay, and disabling releases click targets", (t) => {
  const f = fixture(t);
  f.receive({
    ...status,
    notification: { id: 1, text: "旧结果", url: urlB, expiresAt: Date.now() - 1 },
  });
  assert.equal(f.sprite.bubble.textContent, "任务 A");
  f.receive({ ...status, enabled: false });
  assert.equal(f.sprite.paseoBubbleUrl, null);
  f.sprite.onClick(click(2));
  assert.deepEqual(f.opened, []);
});
