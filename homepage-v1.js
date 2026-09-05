// HOMEPAGE EVOLUTION PASS (2026-07-27) — JS vanilla, sem dependência, sem CDN.
// Só faz scroll-reveal leve (.reveal -> .is-visible) via IntersectionObserver.
//
// Regra de segurança (2026-09-04): o conteúdo NUNCA pode ficar invisível.
// O CSS só esconde um bloco enquanto a classe "js-reveal" estiver no <html>, e
// essa classe só é adicionada aqui, depois de confirmar que este script está
// mesmo rodando, que o usuário não pediu menos movimento e que o
// IntersectionObserver existe. Se este arquivo não carregar, falhar ou sair
// cedo, a classe não entra e a página aparece inteira, sem depender de JS.
// Como rede de segurança adicional, tudo que ainda estiver escondido depois do
// load é revelado de qualquer forma — um observer que nunca dispara (aba
// throttled, por exemplo) não deixa mais a página em branco.
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
    { threshold: 0.15 }
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
    window.setTimeout(revealEverythingLeft, 1500);
  });
})();

// AMBIENTE — modulação da cena. Este bloco NÃO controla a rolagem: ele apenas
// lê a posição e escreve variáveis CSS. Sem ele a cena continua composta,
// apenas sem parallax e com uma presença média fixa.
(function () {
  "use strict";

  var ambiente = document.querySelector(".ambiente");
  if (!ambiente) {
    return;
  }

  var raiz = document.documentElement;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  // Roteiro da cena. É a MESMA cena do início ao fim: nada é trocado, só a
  // distribuição muda. Quatro canais por bloco, todos interpolados juntos:
  //
  //   presenca — quanta rede aparece
  //   luz      — quanta luz a cena recebe
  //   ar       — quanto do primeiro plano ainda está na frente da câmera
  //   energia  — quanto pulso corre pelos traços
  //
  // Lido em sequência: abertura profunda e viva; o Problema escurece e perde
  // energia; O que construímos traz a energia de volta e é o pico do miolo;
  // Como funciona se contém; Princípios é quase silêncio; o fechamento retoma luz
  // e profundidade sem repetir a abertura — o ar próximo não volta.
  //
  // ATENÇÃO: a ordem deste array precisa acompanhar a ordem das seções no HTML.
  // medir() percorre o roteiro na ordem em que está escrito e cenaEm() assume
  // que os centros resultantes crescem junto com a rolagem. Trocar duas seções
  // de lugar no index.html sem trocar aqui quebra a interpolação em silêncio,
  // sem erro no console. Um id que não existe mais é simplesmente ignorado.
  var roteiro = [
    //  id               presenca  luz    ar     energia
    ["hero",             1,        1,     1,     1],
    ["problema",         0.34,     0.3,   0.12,  0.15],
    // A Lógica é ponte, não pico: a cena começa a se reorganizar depois da
    // queda do Problema e entrega a página já subindo para as capacidades.
    ["logica",           0.46,     0.54,  0.06,  0.58],
    // "O que construímos" nasceu da fusão de Solução com Serviços e virou a
    // resposta aos dois CTAs da página. Com os valores antigos de catálogo
    // (0.16 / 0.22) ela era o ponto mais escuro do site — mais apagada que o
    // Problema e que Valores, exatamente ao contrário da hierarquia. Herda
    // agora a luz que pertencia à Solução: é aqui que a energia volta.
    ["servicos",         0.6,      0.68,  0.04,  0.85],
    ["como-funciona",    0.3,      0.44,  0.02,  0.4],
    ["principios",       0.13,     0.2,   0,     0.06],
    ["cta-final",        0.86,     0.95,  0.18,  0.88],
    // O rodapé nunca aparece sozinho: ele entra no quadro junto com o CTA e é a
    // cauda do mesmo plano. Por isso fecha perto do CTA, um degrau abaixo — a
    // cena assenta depois do pico em vez de apagar no último bloco.
    ["rodape",           0.7,      0.86,  0.12,  0.7]
  ];

  var CANAIS = 4;
  var PADRAO = [0.62, 0.8, 0.4, 0.5];
  var cenas = [];

  function medir() {
    cenas = [];
    for (var i = 0; i < roteiro.length; i++) {
      var el = document.getElementById(roteiro[i][0]);
      if (!el) {
        continue;
      }
      var caixa = el.getBoundingClientRect();
      var topo = caixa.top + window.scrollY;
      cenas.push({ centro: topo + caixa.height / 2, valores: roteiro[i].slice(1) });
    }
  }

  // Interpola entre os centros dos blocos, para a cena mudar de forma contínua
  // em vez de saltar na divisória. Os quatro canais andam juntos, então a
  // transição entre dois blocos é uma só mudança de atmosfera, não quatro.
  function cenaEm(y) {
    if (!cenas.length) {
      return PADRAO;
    }
    // Onde a câmera está olhando. No miolo da página é o meio do viewport, mas
    // nas duas pontas isso não alcança: o Hero é mais baixo que a janela, e o
    // fechamento fica abaixo do último scroll possível. Sem corrigir, nem a
    // abertura nem o fechamento chegam à própria intensidade — justamente os
    // dois momentos que precisam ser mais fortes.
    //   topo  — o foco sobe até o Hero e só desce quando a rolagem começa;
    //   fim   — o foco desce até o rodapé conforme a página acaba.
    // No meio do caminho os dois termos se cancelam e nada muda.
    var meia = window.innerHeight / 2;
    var fim = Math.max(1, raiz.scrollHeight - window.innerHeight);
    var abertura = Math.min(1, y / (meia || 1));
    var fechamento = 1 - Math.min(1, (fim - y) / (meia || 1));
    var foco = y + meia * abertura + meia * fechamento;
    if (foco <= cenas[0].centro) {
      return cenas[0].valores;
    }
    for (var i = 1; i < cenas.length; i++) {
      if (foco <= cenas[i].centro) {
        var a = cenas[i - 1];
        var b = cenas[i];
        var t = (foco - a.centro) / (b.centro - a.centro || 1);
        var saida = [];
        for (var c = 0; c < CANAIS; c++) {
          saida.push(a.valores[c] + (b.valores[c] - a.valores[c]) * t);
        }
        return saida;
      }
    }
    return cenas[cenas.length - 1].valores;
  }

  // Parallax limitado: o deslocamento satura, então nunca vira deriva.
  function deslocamento(y, limite) {
    return (limite * Math.tanh(y / 1200)).toFixed(1) + "px";
  }

  var agendado = false;

  function aplicar() {
    agendado = false;
    var y = window.scrollY || window.pageYOffset || 0;
    var estilo = getComputedStyle(ambiente);
    var escala = parseFloat(estilo.getPropertyValue("--ambiente-escala")) || 1;
    var minimo = parseFloat(estilo.getPropertyValue("--ambiente-presenca-min"));
    var maximo = parseFloat(estilo.getPropertyValue("--ambiente-presenca-max"));
    var cena = cenaEm(y);
    var presenca = cena[0] * escala;
    // Os limites declarados no CSS mandam: a narrativa nunca sai deles.
    if (!isNaN(minimo)) { presenca = Math.max(minimo, presenca); }
    if (!isNaN(maximo)) { presenca = Math.min(maximo, presenca); }
    ambiente.style.setProperty("--ambiente-presenca", presenca.toFixed(3));
    // Os canais saem crus, entre 0 e 1. Quanto disso chega à tela é decisão do
    // CSS (--luz-canal-max por breakpoint), não deste script.
    ambiente.style.setProperty("--ambiente-luz", cena[1].toFixed(3));
    ambiente.style.setProperty("--ambiente-ar", cena[2].toFixed(3));
    ambiente.style.setProperty("--ambiente-energia", cena[3].toFixed(3));
    // Deslocamento por plano: quanto mais perto da câmera, mais o plano anda.
    // A diferença entre as quatro amplitudes é o que se lê como profundidade.
    raiz.style.setProperty("--ambiente-y-fundo", deslocamento(y, -14));
    raiz.style.setProperty("--ambiente-y-medio", deslocamento(y, -36));
    raiz.style.setProperty("--ambiente-y-frente", deslocamento(y, -60));
    raiz.style.setProperty("--ambiente-y-ar", deslocamento(y, -84));
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
  window.addEventListener("resize", function () {
    medir();
    agendar();
  }, { passive: true });

  // Parallax de ponteiro apenas onde existe ponteiro fino. Amplitude mínima:
  // a atmosfera responde, nada segue o cursor.
  if (!window.matchMedia("(pointer: fine)").matches) {
    return;
  }

  var px = 0;
  var py = 0;
  var agendadoPonteiro = false;

  window.addEventListener("pointermove", function (evento) {
    px = evento.clientX / window.innerWidth - 0.5;
    py = evento.clientY / window.innerHeight - 0.5;
    if (agendadoPonteiro) {
      return;
    }
    agendadoPonteiro = true;
    window.requestAnimationFrame(function () {
      agendadoPonteiro = false;
      raiz.style.setProperty("--ambiente-ponteiro-x", (px * 9).toFixed(1) + "px");
      raiz.style.setProperty("--ambiente-ponteiro-y", (py * 7).toFixed(1) + "px");
    });
  }, { passive: true });
})();
