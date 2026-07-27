// HOMEPAGE EVOLUTION PASS (2026-07-27) — JS vanilla, sem dependência, sem CDN.
// Só faz scroll-reveal leve (.reveal -> .is-visible) via IntersectionObserver.
// Respeita prefers-reduced-motion: se o usuário pediu menos movimento, não faz nada
// (o CSS já deixa .reveal visível por padrão nesse caso).
//
// DEPLOY CANDIDATE (2026-07-27): cópia deste arquivo, sem alteração de conteúdo,
// preparada para servir como root de um projeto Vercel. Ver README.md desta pasta.
(function () {
  "use strict";

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

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  targets.forEach(function (el) {
    observer.observe(el);
  });
})();
