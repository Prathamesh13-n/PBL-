const aiToggle = document.getElementById('aiToggle');
const aiPanel = document.getElementById('aiPanel');
const aiClose = document.getElementById('aiClose');
const aiForm = document.getElementById('aiForm');
const aiInput = document.getElementById('aiInput');
const aiMessages = document.getElementById('aiMessages');

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'ai-message ' + role;
  div.textContent = text;
  aiMessages.appendChild(div);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

aiToggle.addEventListener('click', () => {
  aiPanel.hidden = !aiPanel.hidden;
  if (!aiPanel.hidden) aiInput.focus();
});
aiClose.addEventListener('click', () => aiPanel.hidden = true);

aiForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = aiInput.value.trim();
  if (!text) return;
  appendMessage('user', text);
  aiInput.value = '';

  appendMessage('assistant', '…thinking');
  const thinkingNode = aiMessages.lastChild;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: text,
        context: {
          // expose small, safe context to the assistant
          reportsCount: document.querySelectorAll('#reportsList li').length || 0
        }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || JSON.stringify(data));

    thinkingNode.textContent = data.reply || 'No reply';
  } catch (err) {
    thinkingNode.textContent = 'Error: ' + (err.message || err);
  }
});
