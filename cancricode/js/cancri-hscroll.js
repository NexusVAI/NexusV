/**
 * cancri-hscroll.js — 粘性横向滚动卡片带（OWNED，占位实现）
 * 纵向滚动进度 → 轨道 translateX。外层高度 = 吸顶视口高度 + 横移距离，
 * 所以横移走完的那一刻刚好解除吸顶。样式见 css/cancri-hscroll.css。
 */
(function () {
  'use strict';

  function init() {
    var root = document.querySelector('[data-cancri-role="hscroll"]');
    if (!root) return;
    var sticky = root.querySelector('.cancri-hscroll__sticky');
    var track = root.querySelector('.cancri-hscroll__track');
    if (!sticky || !track) return;

    var mqDesktop = window.matchMedia('(min-width: 768px)');
    var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var nav = document.querySelector('.nav_component');
    var enabled = false;
    var distance = 0;
    var top = 0;
    var raf = 0;

    function update() {
      raf = 0;
      if (!enabled) return;
      var passed = top - root.getBoundingClientRect().top;
      var p = distance > 0 ? Math.min(1, Math.max(0, passed / distance)) : 0;
      track.style.transform = 'translate3d(' + (-p * distance).toFixed(1) + 'px,0,0)';
    }

    function schedule() {
      if (!raf) raf = window.requestAnimationFrame(update);
    }

    function measure() {
      enabled = mqDesktop.matches && !mqReduce.matches;
      root.classList.toggle('is-pinned', enabled);
      track.style.transform = '';
      if (!enabled) {
        root.style.height = '';
        return;
      }
      top = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
      root.style.setProperty('--cancri-hscroll-top', top + 'px');
      distance = Math.max(0, Math.ceil(track.scrollWidth - sticky.clientWidth));
      root.style.height = sticky.offsetHeight + distance + 'px';
      update();
    }

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure);
    [mqDesktop, mqReduce].forEach(function (mq) {
      if (mq.addEventListener) mq.addEventListener('change', measure);
      else if (mq.addListener) mq.addListener(measure);
    });
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { measure(); });
      ro.observe(track);
      if (nav) ro.observe(nav); // 顶部公告关闭后导航变矮
    }
    root.querySelectorAll('img').forEach(function (img) {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
