import { getBrowserContext } from '../ats-engine/browserManager.js';

async function inspectErrors() {
  const context = await getBrowserContext();
  const p = context.pages().find(x => x.url().includes('apply/autofillWithResume'));
  if (!p) {
    console.log('Tab not found');
    process.exit(1);
  }

  const res = await p.evaluate(() => {
    const errorEls = Array.from(document.querySelectorAll('[data-automation-id*="error"], [role="alert"], [aria-invalid="true"]'));
    const formFields = Array.from(document.querySelectorAll('input')).map(i => ({
      name: i.name,
      id: i.id,
      autoId: i.getAttribute('data-automation-id'),
      type: i.type,
      val: i.value,
      ariaInvalid: i.getAttribute('aria-invalid')
    }));

    return {
      errors: errorEls.map(e => e.innerText.trim()).filter(Boolean),
      inputs: formFields
    };
  });

  console.log('PAGE INSPECTION:\n', JSON.stringify(res, null, 2));
  process.exit(0);
}

inspectErrors().catch(e => console.error(e));
