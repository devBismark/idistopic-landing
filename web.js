/* ==========================================================================
   IDISTØPIC WEB — COMMERCIAL EXPERIENCE JAVASCRIPT (web.js)
   Vanilla JS. Zero external dependencies. Zero network calls.
   - Market switcher (BR / PT)
   - Accessible FAQ accordion
   - Fail-safe Scroll reveal (.reveal -> .is-visible)
   ========================================================================== */

(function () {
  "use strict";

  // ------------------------------------------------------------------------
  // 1. SCROLL REVEAL (Fail-safe: content is always visible by default)
  // ------------------------------------------------------------------------
  function initScrollReveal() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      return;
    }

    var targets = document.querySelectorAll(".reveal");
    if (!targets.length) {
      return;
    }

    var root = document.documentElement;
    root.classList.add("js-reveal");

    function reveal(el) {
      el.classList.add("is-visible");
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            reveal(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    targets.forEach(function (el) {
      observer.observe(el);
    });

    function revealEverythingLeft() {
      var pending = document.querySelectorAll(".reveal:not(.is-visible)");
      if (!pending.length) {
        return;
      }
      Array.prototype.forEach.call(pending, function (el) {
        observer.unobserve(el);
        reveal(el);
      });
    }

    window.addEventListener("load", function () {
      window.setTimeout(revealEverythingLeft, 1200);
    });
  }

  // ------------------------------------------------------------------------
  // 2. MARKET SELECTOR (Brasil / Portugal)
  // ------------------------------------------------------------------------
  function initMarketSelector() {
    var buttons = document.querySelectorAll(".market-btn");
    var priceElements = document.querySelectorAll("[data-price-br][data-price-pt]");
    if (!buttons.length || !priceElements.length) {
      return;
    }

    function setMarket(market) {
      var isPT = market === "pt";
      var currentMarket = isPT ? "pt" : "br";

      buttons.forEach(function (btn) {
        var btnMarket = btn.getAttribute("data-market");
        var active = btnMarket === currentMarket;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });

      priceElements.forEach(function (el) {
        var price = isPT ? el.getAttribute("data-price-pt") : el.getAttribute("data-price-br");
        if (price) {
          el.textContent = price;
        }
      });

      try {
        localStorage.setItem("idistopic_web_market", currentMarket);
      } catch (e) {
        // Local storage unavailable or restricted, ignore safely
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var targetMarket = btn.getAttribute("data-market");
        setMarket(targetMarket);
      });
    });

    // Initial state restore
    var savedMarket = "br";
    try {
      var stored = localStorage.getItem("idistopic_web_market");
      if (stored === "pt" || stored === "br") {
        savedMarket = stored;
      }
    } catch (e) {}

    setMarket(savedMarket);
  }

  // ------------------------------------------------------------------------
  // 3. ACCESSIBLE FAQ ACCORDION
  // ------------------------------------------------------------------------
  function initFAQ() {
    var items = document.querySelectorAll(".faq-item");
    if (!items.length) {
      return;
    }

    items.forEach(function (item) {
      var trigger = item.querySelector(".faq-trigger");
      var panel = item.querySelector(".faq-panel");
      if (!trigger || !panel) {
        return;
      }

      trigger.addEventListener("click", function () {
        var isOpen = item.getAttribute("data-open") === "true";
        var newState = !isOpen;

        item.setAttribute("data-open", newState ? "true" : "false");
        trigger.setAttribute("aria-expanded", newState ? "true" : "false");
      });
    });
  }

  // ------------------------------------------------------------------------
  // INITIALIZE ON DOM READY
  // ------------------------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initScrollReveal();
      initMarketSelector();
      initFAQ();
    });
  } else {
    initScrollReveal();
    initMarketSelector();
    initFAQ();
  }
})();
