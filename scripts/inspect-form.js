import { getBrowserContext } from '../ats-engine/browserManager.js';

async function inspectForm() {
  const context = await getBrowserContext();
  const p = context.pages().find(x => x.url().includes('apply/autofillWithResume'));
  if (!p) {
    console.log('No apply page found');
    process.exit(1);
  }

  const details = await p.evaluate(() => {
    const btn = document.querySelector('button[data-automation-id="createAccountSubmitButton"]');
    if (!btn) return 'Button not found';

    // Get all elements inside the parent container of the button
    const container = btn.closest('[data-automation-id]') || btn.parentElement.parentElement;
    return {
      btnDisabled: btn.disabled,
      btnAriaDisabled: btn.getAttribute('aria-disabled'),
      btnClasses: btn.className,
      containerHtml: container.innerHTML.slice(0, 1000)
    };
  });

  console.log('Form details:\n', JSON.stringify(details, null, 2));
  process.exit(0);
}

inspectForm().catch(e => console.error(e));
