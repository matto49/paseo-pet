// Loaded after the original sprite methods, before its boot entry point.
(() => {
  const api = window.paseoPetBridge;
  if (!api || typeof PetSprite === "undefined") return;
  let navigation = null;
  const instances = new Set();
  const proto = PetSprite.prototype;
  const original = {
    bindEvents: proto.bindEvents,
    dispose: proto.dispose,
    onClick: proto.onClick,
    renderBubble: proto.renderBubble,
    workClickable: proto.workClickable,
    openWorkSession: proto.openWorkSession,
  };
  const apply = (sprite) => {
    // dsh-pet's first HTTP snapshot only establishes a baseline. Restore work
    // already running before this window booted; real change ticks are positive.
    if (
      navigation?.enabled &&
      navigation.work?.state &&
      sprite.prevWorkTick === 0 &&
      typeof sprite.onWorkTick === "function"
    ) {
      sprite.onWorkTick({ state: navigation.work.state, task: navigation.work.task }, -1);
    }
    const notification = navigation?.enabled ? navigation.notification : null;
    if (
      notification?.url &&
      notification.expiresAt > Date.now() &&
      sprite.paseoSeen !== notification.id
    ) {
      sprite.paseoSeen = notification.id;
      // Capture the producing session; subsequent work-selection changes cannot rewrite it.
      sprite.paseoNotification = Object.freeze({ ...notification });
      clearTimeout(sprite.paseoTimer);
      sprite.paseoTimer = setTimeout(() => {
        sprite.paseoNotification = null;
        sprite.renderBubble();
      }, notification.expiresAt - Date.now());
    }
    if (!navigation?.enabled) sprite.paseoNotification = null;
    sprite.renderBubble();
  };
  proto.bindEvents = function (...args) {
    original.bindEvents.apply(this, args);
    instances.add(this);
    this.bubble.addEventListener(
      "keydown",
      (event) => {
        if (this.paseoBubbleUrl && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          this.openWorkSession();
        }
      },
      { signal: this.ac.signal },
    );
    apply(this);
  };
  proto.dispose = function (...args) {
    instances.delete(this);
    clearTimeout(this.paseoTimer);
    return original.dispose.apply(this, args);
  };
  proto.onClick = function (event) {
    if (
      navigation?.enabled &&
      !this.justDragged &&
      !this.dragState.active &&
      !this.dragState.dragging &&
      (event.detail === 2 || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      event.stopPropagation();
      this.stopThrow();
      this.stopMove();
      void api.open(navigation.homeUrl);
      return;
    }
    return original.onClick.call(this, event);
  };
  proto.renderBubble = function () {
    this.paseoBubbleUrl = null;
    original.renderBubble.call(this);
    const notice = this.paseoNotification;
    if (navigation?.enabled && notice?.expiresAt > Date.now() && !this.todoOpen && !this.chatOpen) {
      this.bubbleSlot = "paseo";
      this.bubble.classList.remove("is-expanded", "has-img");
      this.bubble.classList.add("is-on", "is-whisper", "is-clickable");
      this.bubble.textContent = notice.text;
      this.paseoBubbleUrl = notice.url;
    } else if (
      navigation?.enabled &&
      this.bubbleSlot === "work" &&
      navigation.work?.task === this.workText &&
      navigation.work?.state === this.workState
    ) {
      this.paseoBubbleUrl = navigation.work.url;
    }
    const link = this.paseoBubbleUrl;
    if (link) {
      this.bubble.classList.add("is-clickable");
      this.bubble.setAttribute("role", "link");
      this.bubble.setAttribute("tabindex", "0");
      this.bubble.setAttribute("title", "点击打开对应的 Paseo 会话");
    } else {
      this.bubble.removeAttribute("role");
      this.bubble.removeAttribute("tabindex");
      this.bubble.removeAttribute("title");
    }
    this.syncInputBusy();
    const report = {
      bubbleUrl: link,
      slot: this.bubbleSlot,
      clickable: this.bubble.classList.contains("is-clickable"),
      size: this.pet?.size,
    };
    const signature = JSON.stringify(report);
    if (signature !== this.paseoReported) {
      this.paseoReported = signature;
      api.report?.(report);
    }
  };
  proto.workClickable = function () {
    return !!this.paseoBubbleUrl || original.workClickable.call(this);
  };
  proto.openWorkSession = function () {
    if (this.paseoBubbleUrl) {
      void api.open(this.paseoBubbleUrl);
      return;
    }
    return original.openWorkSession.call(this);
  };
  api.subscribe((value) => {
    navigation = value;
    for (const sprite of instances) apply(sprite);
  });
})();
