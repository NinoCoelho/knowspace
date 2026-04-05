/**
 * knowspace configure — interactive setup command.
 * First run: wizard (sequential). Subsequent runs: menu.
 */

const { isFirstRun } = require('./configure/state');

module.exports = async function configure(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
  knowspace configure - Interactive setup

  Usage:
    knowspace configure            Run wizard (first time) or menu (subsequent)
    knowspace configure --reset    Reset and run wizard again

  On first run, guides you through workspace, vault, skills, and token setup.
  On subsequent runs, opens a menu to modify any configuration.
`);
    return;
  }

  const forceWizard = argv.includes('--reset');

  if (forceWizard || isFirstRun()) {
    const wizard = require('./configure/wizard');
    await wizard();
  } else {
    const menu = require('./configure/menu');
    await menu();
  }
};
