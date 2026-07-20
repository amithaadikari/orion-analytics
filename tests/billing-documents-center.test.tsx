// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import BillingDocumentsCenter from '@/components/billing-documents-center';

afterEach(cleanup);

const activeLicense = {
  id: 'license-basic',
  plan: 'Basic',
  platform: 'MT5',
  status: 'Active',
  issued_at: '2026-07-01T00:00:00Z',
  expires_at: '2026-08-19',
};

const paidPayment = {
  id: 'payment-paid',
  plan: 'Basic',
  method: 'Crypto',
  status: 'Paid',
  amount: 479,
  currency: 'USD',
  payment_date: '2026-07-19',
  reference_id: 'ORION-PAID-001',
  receipt_number: 'ORN-2026-001001',
  created_at: '2026-07-19T12:00:00Z',
};

const baseProps = {
  client: { plan: 'Basic', status: 'Active' },
  payments: [paidPayment],
  licenses: [activeLicense],
  paymentsAvailable: true,
  licensesAvailable: true,
  asOf: '2026-07-20T12:00:00Z',
};

describe('Billing and Documents Center', () => {
  it('shows the current access term, readable money, and safe document actions', () => {
    render(<BillingDocumentsCenter {...baseProps} />);

    expect(screen.getByText('Your payment center')).toBeTruthy();
    expect(screen.getByText('30 days remaining')).toBeTruthy();
    expect(screen.getAllByText('$479').length).toBeGreaterThan(0);
    expect(screen.queryByText('$479.00')).toBeNull();
    expect(screen.getAllByRole('link', { name: /Open invoice for Basic payment/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Open receipt for Basic payment/i }).length).toBeGreaterThan(0);
  });

  it('never links a retained receipt number after a payment is refunded', () => {
    render(<BillingDocumentsCenter {...baseProps} payments={[{ ...paidPayment, status: 'Refunded' }]} />);

    expect(screen.getByText(/This payment was refunded/i)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Open invoice for Basic payment/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Open receipt/i })).toBeNull();
    expect(screen.getAllByText('0', { selector: 'strong' }).length).toBeGreaterThan(0);
  });

  it.each([
    ['Paid', true],
    ['Manually verified', true],
    ['Pending', false],
    ['Failed', false],
    ['Refunded', false],
    ['Disputed', false],
  ])('applies the receipt rule to %s records', (status, receiptAvailable) => {
    render(<BillingDocumentsCenter {...baseProps} payments={[{ ...paidPayment, status }]} />);

    expect(screen.queryAllByRole('link', { name: /Open receipt/i }).length > 0).toBe(receiptAvailable);
  });

  it('explains a completed payment whose receipt has not been issued yet', () => {
    render(<BillingDocumentsCenter {...baseProps} payments={[{ ...paidPayment, receipt_number: '   ' }]} />);

    expect(screen.getAllByText('Receipt being prepared').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Open receipt/i })).toBeNull();
  });

  it('filters completed, pending, and attention records without changing their status truth', () => {
    const pending = { ...paidPayment, id: 'payment-pending', reference_id: 'ONLY-PENDING', status: 'Pending', receipt_number: null, payment_date: null, created_at: '2026-07-20T10:00:00Z' };
    const failed = { ...paidPayment, id: 'payment-failed', reference_id: 'ONLY-FAILED', status: 'Failed', receipt_number: null, payment_date: null, created_at: '2026-07-18T10:00:00Z' };
    render(<BillingDocumentsCenter {...baseProps} payments={[pending, paidPayment, failed]} />);

    fireEvent.click(screen.getByRole('button', { name: /Pending 1/i }));
    expect(screen.getAllByText(/ONLY-PENDING/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ONLY-FAILED/i)).toBeNull();
    expect(screen.getAllByText(/Recorded Jul 2026/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Needs attention 1/i }));
    expect(screen.getAllByText(/ONLY-FAILED/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/ONLY-PENDING/i)).toBeNull();
  });

  it('distinguishes unavailable payment records from a real empty history', () => {
    const { rerender } = render(<BillingDocumentsCenter {...baseProps} payments={[]} paymentsAvailable={false} />);

    expect(screen.getByText('Payment status temporarily unavailable')).toBeTruthy();
    expect(screen.getByText('Transaction history unavailable')).toBeTruthy();
    expect(screen.queryByText('No transactions recorded')).toBeNull();

    rerender(<BillingDocumentsCenter {...baseProps} payments={[]} paymentsAvailable />);
    expect(screen.getByText('No billing records yet')).toBeTruthy();
    expect(screen.getByText('No transactions recorded')).toBeTruthy();
  });

  it('does not call a missing Basic expiry lifetime access', () => {
    render(<BillingDocumentsCenter {...baseProps} licenses={[{ ...activeLicense, expires_at: null }]} />);

    expect(screen.getByText('Expiry date not set')).toBeTruthy();
    expect(screen.queryByText('Lifetime access')).toBeNull();
  });

  it('shows lifetime access only for a matching active Lifetime license', () => {
    render(<BillingDocumentsCenter {...baseProps} client={{ plan: 'Lifetime', status: 'Active' }} licenses={[{ ...activeLicense, plan: 'Lifetime', expires_at: null }]} />);

    expect(screen.getByText('Lifetime access')).toBeTruthy();
    expect(screen.getByText('No renewal required')).toBeTruthy();
  });

  it('keeps an old-plan license out of the current renewal summary', () => {
    render(<BillingDocumentsCenter {...baseProps} client={{ plan: 'Premium', status: 'Active' }} />);

    expect(screen.getByText('License pending')).toBeTruthy();
    expect(screen.queryByText('30 days remaining')).toBeNull();
  });

  it('keeps payment history available when only license dates fail to load', () => {
    render(<BillingDocumentsCenter {...baseProps} licensesAvailable={false} />);

    expect(screen.getByText('Status unavailable')).toBeTruthy();
    expect(screen.getAllByText('$479').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Open invoice/i }).length).toBeGreaterThan(0);
  });

  it('keeps long histories compact until the client asks for older records', () => {
    const payments = Array.from({ length: 7 }, (_, index) => ({ ...paidPayment, id: `payment-${index}`, reference_id: `ROW-${index}`, created_at: `2026-07-${String(20 - index).padStart(2, '0')}T10:00:00Z`, payment_date: null }));
    render(<BillingDocumentsCenter {...baseProps} payments={payments} />);

    expect(screen.queryByText('ROW-5')).toBeNull();
    const showOlder = screen.getByRole('button', { name: /Show 2 older records/i });
    expect(showOlder.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(showOlder);
    expect(screen.getByText(/ROW-5/)).toBeTruthy();
    expect(screen.getByText(/ROW-6/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Show recent records/i }).getAttribute('aria-expanded')).toBe('true');
  });
});
