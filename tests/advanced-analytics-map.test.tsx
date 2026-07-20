// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorldActivityMap } from '@/components/advanced-analytics';

describe('visitor world heat map', () => {
  it('maps real country shapes to visitor data and keeps them keyboard accessible', () => {
    const onSelect = vi.fn();
    render(<WorldActivityMap countries={[{ name: 'US', value: 32 }, { name: 'Sri Lanka', value: 18 }]} activeCountry={null} onSelect={onSelect} />);

    const unitedStates = screen.getByLabelText('United States: 32 visitors, 64.0% of selected traffic');
    expect(unitedStates.getAttribute('d')).toBeTruthy();
    fireEvent.click(unitedStates);

    const sriLanka = screen.getByLabelText('Sri Lanka: 18 visitors, 36.0% of selected traffic');
    fireEvent.keyDown(sriLanka, { key: 'Enter' });

    expect(onSelect).toHaveBeenNthCalledWith(1, 'US');
    expect(onSelect).toHaveBeenNthCalledWith(2, 'Sri Lanka');
  });

  it('keeps small countries visible and interactive with a geographic beacon', () => {
    const onSelect = vi.fn();
    render(<WorldActivityMap countries={[{ name: 'SG', value: 4 }]} activeCountry={null} onSelect={onSelect} />);

    const singapore = screen.getByLabelText('Singapore: 4 visitors, select country filter');
    fireEvent.keyDown(singapore, { key: ' ' });

    expect(onSelect).toHaveBeenCalledWith('SG');
  });
});
