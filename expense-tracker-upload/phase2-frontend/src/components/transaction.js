const pad = (n) => String(n).padStart(2, '0');

export const newTransactionId = (d = new Date()) =>
  `T-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}-${Math.random().toString(36).slice(2, 6)}`;

export const transactionGroups = (expenses) => {
  const groups = {};
  expenses.forEach(e => {
    if (!e.transactionId) return;
    groups[e.transactionId] = groups[e.transactionId] || { count: 0, total: 0 };
    groups[e.transactionId].count += 1;
    groups[e.transactionId].total += Number(e.amount) || 0;
  });
  return groups;
};
