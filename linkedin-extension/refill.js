// LinkedIn Easy Apply Re-fill Helper

export function injectLinkedInRefillButton(modal, onRefillClick) {
  if (modal.querySelector('#job-agent-modal-refill-btn')) return;

  const footer = modal.querySelector('footer');
  if (!footer) return;

  const btn = document.createElement('button');
  btn.id = 'job-agent-modal-refill-btn';
  btn.type = 'button';
  btn.className = 'artdeco-button artdeco-button--tertiary';
  btn.style.cssText = `
    margin-right: auto;
    color: #3b82f6;
    font-weight: 700;
    border: 1px solid rgba(59, 130, 246, 0.4);
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
  `;
  btn.innerHTML = '🔄 Re-fill Form';

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.innerText = 'Refilling...';
    btn.disabled = true;
    onRefillClick().finally(() => {
      btn.innerText = '🔄 Re-fill Form';
      btn.disabled = false;
    });
  });

  footer.prepend(btn);
}
