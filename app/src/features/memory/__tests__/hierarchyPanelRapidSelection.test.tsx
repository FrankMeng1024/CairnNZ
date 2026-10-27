import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { HierarchyPanel } from '../components/HierarchyPanel';
import { fetchPanelData } from '../services/hierarchyService';

jest.mock('../services/hierarchyService', () => ({
  fetchPanelData: jest.fn(),
}));

const mockFetchPanelData = fetchPanelData as jest.MockedFunction<typeof fetchPanelData>;
const bbox: [number, number, number, number] = [166, -48, 179, -34];
const panelData = {
  title: { id: 'nz', name_en: 'New Zealand', level: 2 as const },
  parent: { id: 'world', name_en: 'World', level: 0 as const },
  items: [
    { id: 'nz-auckland', name_en: 'Auckland', state: 'marked' as const, bbox, is_here: true },
    { id: 'nz-dunedin', name_en: 'Dunedin', state: 'walked' as const, bbox, is_here: false },
    { id: 'nz-wellington', name_en: 'Wellington', state: 'walked' as const, bbox, is_here: false },
  ],
  locked_count: 0,
};

function panel(currentCityId: string, onSelectItem: jest.Mock) {
  return (
    <HierarchyPanel
      titleId="nz"
      currentCityId={currentCityId}
      currentCountryId="nz"
      onSelectItem={onSelectItem}
      onGoUp={jest.fn()}
      onClose={jest.fn()}
    />
  );
}

describe('HierarchyPanel rapid city selection', () => {
  beforeEach(() => {
    mockFetchPanelData.mockReset();
    mockFetchPanelData.mockResolvedValue(panelData);
  });

  test('keeps keyed rows interactive and moves the here marker without a same-level refetch', async () => {
    const onSelectItem = jest.fn();
    const screen = render(panel('nz-auckland', onSelectItem));
    await act(async () => { await Promise.resolve(); });
    expect(mockFetchPanelData).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('hierarchy-row-nz-dunedin')).toBeTruthy());

    fireEvent.press(screen.getByTestId('hierarchy-row-nz-dunedin'));
    expect(onSelectItem).toHaveBeenLastCalledWith('nz-dunedin', 'city', bbox);

    screen.rerender(panel('nz-dunedin', onSelectItem));
    expect(screen.getByTestId('hierarchy-row-nz-dunedin').props.accessibilityState)
      .toEqual({ selected: true });
    expect(mockFetchPanelData).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('hierarchy-row-nz-wellington'));
    expect(onSelectItem).toHaveBeenLastCalledWith('nz-wellington', 'city', bbox);
    expect(mockFetchPanelData).toHaveBeenCalledTimes(1);
  });
});
