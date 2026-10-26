/* Start-up order: windows layer, Dock (windows measure it), desktop icons, menu bar,
   then the boot screens on top. */
(function () {
  'use strict';

  window.MacWM.init();
  window.MacDock.init();
  window.MacDesktop.render();
  window.MacMenuBar.init();
  window.MacBoot.init();
})();
