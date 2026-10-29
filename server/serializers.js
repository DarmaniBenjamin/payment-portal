// How invoices look in API responses and webhook payloads (one place, so they always match)

export function payUrl(publicId) {
  return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/pay/${publicId}`;
}

export function invoiceJson(row) {
  return {
    id: row.public_id,
    number: row.number,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    external_ref: row.external_ref,
    due_date: row.due_date,
    paid_at: row.paid_at,
    created_at: row.created_at,
    pay_url: payUrl(row.public_id),
  };
}
