// CAMADA DAS PAGINAS SECUNDARIAS — /solucoes e /trabalhos (2026-09-06).
// JS vanilla, sem dependencia, sem CDN. Dois blocos independentes: revelacao
// no scroll e modulacao da cena de ambiente. Nenhum dos dois controla a
// rolagem; ambos apenas leem posicao e escrevem variaveis CSS.

// REVELACAO
//
// Regra de seguranca herdada da homepage: o conteudo NUNCA pode ficar
// invisivel. O CSS so esconde um bloco enquanto "js-revela" estiver no <html>,
// e essa classe so entra aqui, depois de confirmar que este script esta mesmo
// rodando, que o IntersectionObserver existe e que ninguem pediu menos
// movimento. Se este arquivo nao carregar, falhar ou sair cedo, a classe nao
// entra e a pagina aparece inteira, sem depender de JS.
(function () {
  "use strict";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  if (!("IntersectionObserver" in window)) {
    return;
  }

  var alvos = document.querySelectorAll(".revela");
  if (!alvos.length) {
    return;
  }

  document.documentElement.classList.add("js-revela");

  var observador = new IntersectionObserver(
    function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add("visivel");
          observador.unobserve(entrada.target);
        }
      });
    },
    { threshold: 0.14 }
  );

  alvos.forEach(function (el) {
    observador.observe(el);
  });

  // Rede de seguranca: um observer que nunca dispara (aba em segundo plano,
  // por exemplo) nao pode deixar a pagina em branco.
  window.addEventListener("load", function () {
    window.setTimeout(function () {
      var pendentes = document.querySelectorAll(".revela:not(.visivel)");
      Array.prototype.forEach.call(pendentes, function (el) {
        observador.unobserve(el);
        el.classList.add("visivel");
      });
    }, 1500);
  });
})();

// CENA
//
// A cena e uma so, do topo ao rodape: nada e trocado, so a distribuicao muda.
// Tres canais por bloco, interpolados juntos, entao a passagem entre duas
// secoes e uma unica mudanca de atmosfera e nao tres saltos.
//
//   presenca — quanta malha aparece
//   luz      — quanta luz a cena recebe
//   energia  — quanto pulso corre pelos tracos
//
// O roteiro NAO mora aqui. Cada secao declara o seu no atributo data-cena, na
// ordem "presenca luz energia". Assim as duas paginas usam o mesmo script sem
// ramificacao, e reordenar uma secao no HTML nunca quebra a interpolacao em
// silencio, que e a fragilidade conhecida do roteiro fixo da homepage.
(function () {
  "use strict";

  var cena = document.querySelector(".cena");
  if (!cena) {
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  var raiz = document.documentElement;
  var blocos = document.querySelectorAll("[data-cena]");
  if (!blocos.length) {
    return;
  }

  var PADRAO = [0.55, 0.8, 0.45];
  var marcos = [];

  function medir() {
    marcos = [];
    Array.prototype.forEach.call(blocos, function (el) {
      var valores = el.getAttribute("data-cena").split(/\s+/).map(Number);
      if (valores.length !== 3 || valores.some(isNaN)) {
        return;
      }
      var caixa = el.getBoundingClientRect();
      marcos.push({ centro: caixa.top + window.scrollY + caixa.height / 2, valores: valores });
    });
    marcos.sort(function (a, b) {
      return a.centro - b.centro;
    });
  }

  // Onde a camera esta olhando. No miolo da pagina e o meio da janela, mas nas
  // duas pontas isso nao alcanca: a abertura e mais baixa que a janela e o
  // fechamento fica abaixo da ultima rolagem possivel. Sem corrigir, nem o
  // hero nem o fechamento chegam a propria intensidade.
  function foco(y) {
    var meia = window.innerHeight / 2;
    var fim = Math.max(1, raiz.scrollHeight - window.innerHeight);
    var abertura = Math.min(1, y / (meia || 1));
    var fechamento = 1 - Math.min(1, (fim - y) / (meia || 1));
    return y + meia * abertura + meia * fechamento;
  }

  function cenaEm(y) {
    if (!marcos.length) {
      return PADRAO;
    }
    var alvo = foco(y);
    if (alvo <= marcos[0].centro) {
      return marcos[0].valores;
    }
    for (var i = 1; i < marcos.length; i++) {
      if (alvo <= marcos[i].centro) {
        var a = marcos[i - 1];
        var b = marcos[i];
        var t = (alvo - a.centro) / (b.centro - a.centro || 1);
        return a.valores.map(function (valor, c) {
          return valor + (b.valores[c] - valor) * t;
        });
      }
    }
    return marcos[marcos.length - 1].valores;
  }

  // Paralaxe limitada: o deslocamento satura, entao nunca vira deriva.
  function desloca(y, limite) {
    return (limite * Math.tanh(y / 1200)).toFixed(1) + "px";
  }

  var agendado = false;

  function aplicar() {
    agendado = false;
    var y = window.scrollY || window.pageYOffset || 0;
    var valores = cenaEm(y);
    // Os canais saem crus, entre 0 e 1. Quanto disso chega a tela e decisao do
    // CSS, via --cena-intensidade e --canal-max por breakpoint.
    cena.style.setProperty("--cena-presenca", valores[0].toFixed(3));
    cena.style.setProperty("--cena-luz", valores[1].toFixed(3));
    cena.style.setProperty("--cena-energia", valores[2].toFixed(3));
    // Deslocamento por plano: quanto mais perto da camera, mais o plano anda.
    raiz.style.setProperty("--cena-y-longe", desloca(y, -12));
    raiz.style.setProperty("--cena-y-meio", desloca(y, -32));
    raiz.style.setProperty("--cena-y-perto", desloca(y, -54));
  }

  function agendar() {
    if (!agendado) {
      agendado = true;
      window.requestAnimationFrame(aplicar);
    }
  }

  medir();
  aplicar();

  window.addEventListener("scroll", agendar, { passive: true });
  window.addEventListener(
    "resize",
    function () {
      medir();
      agendar();
    },
    { passive: true }
  );

  // Paralaxe de ponteiro so onde existe ponteiro fino. Amplitude minima: a
  // atmosfera responde, nada segue o cursor.
  if (!window.matchMedia("(pointer: fine)").matches) {
    return;
  }

  var px = 0;
  var py = 0;
  var agendadoPonteiro = false;

  window.addEventListener(
    "pointermove",
    function (evento) {
      px = evento.clientX / window.innerWidth - 0.5;
      py = evento.clientY / window.innerHeight - 0.5;
      if (agendadoPonteiro) {
        return;
      }
      agendadoPonteiro = true;
      window.requestAnimationFrame(function () {
        agendadoPonteiro = false;
        raiz.style.setProperty("--cena-ponteiro-x", (px * 8).toFixed(1) + "px");
        raiz.style.setProperty("--cena-ponteiro-y", (py * 6).toFixed(1) + "px");
      });
    },
    { passive: true }
  );
})();
