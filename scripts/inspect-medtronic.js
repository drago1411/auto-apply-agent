import { getBrowserContext } from '../ats-engine/browserManager.js';

async function main() {
  const ctx = await getBrowserContext();
  const page = ctx.pages().find(p => p.url().includes('medtronic') && p.url().includes('apply'));
  if (!page) return;

  console.log('Testing clicking checkbox label or input...');
  const cbs = await page.$$('input[type="checkbox"]');
  for (const cb of cbs) {
    const id = await cb.getAttribute('id');
    const checked = await cb.isChecked().catch(() => false);
    console.log(`Checkbox ${id} checked: ${checked}`);
    if (!checked) {
      if (id) {
        const label = await page.$(`label[for="${id}"]`);
        if (label) {
          console.log(`Clicking label for ${id}...`);
          await label.click();
        } else {
          await cb.click({ force: true });
        }
      } else {
        await cb.click({ force: true });
      }
    }
  }

  await new Promise(r => setTimeout(r, 1000));
  for (const cb of cbs) {
    const id = await cb.getAttribute('id');
    const checked = await cb.isChecked().catch(() => false);
    const ariaChecked = await cb.getAttribute('aria-checked');
    console.log(`After click - Checkbox ${id}: checked=${checked}, aria-checked=${ariaChecked}`);
  }

  const btn = await page.$('button[data-automation-id="createAccountSubmitButton"]');
  if (btn) {
    console.log('Clicking Create Account...');
    await btn.click();
    await new Promise(r => setTimeout(r, 5000));
    console.log('After submit Title:', await page.title());
    console.log('After submit URL:', page.url());
  }
}

main().catch(console.error);
