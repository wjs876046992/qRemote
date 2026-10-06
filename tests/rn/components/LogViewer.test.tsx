import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { LogViewer } from '@/components/LogViewer';
import {
  getConnectivityLog,
  clearConnectivityLog,
  formatConnectivityLog,
  ConnectivityLogEntry,
} from '@/services/connectivity-log';
jest.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({ colors: require('./theme-mock').mockColors }),
}));

const mockShowToast = jest.fn();
jest.mock('@/context/ToastContext', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(),
}));

jest.mock('@/services/connectivity-log', () => ({
  getConnectivityLog: jest.fn(),
  clearConnectivityLog: jest.fn(),
  formatConnectivityLog: jest.fn(),
}));

const mockGetConnectivityLog = getConnectivityLog as jest.Mock;
const mockClearConnectivityLog = clearConnectivityLog as jest.Mock;
const mockFormatConnectivityLog = formatConnectivityLog as jest.Mock;

const entries: ConnectivityLogEntry[] = [
  { id: 1, timestamp: 1700000000000, level: 'INFO', tag: 'AUTH', message: 'Logged in' },
  { id: 2, timestamp: 1700000001000, level: 'ERROR', tag: 'HTTP', message: 'Request failed' },
];

describe('LogViewer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnectivityLog.mockReturnValue(entries);
    mockFormatConnectivityLog.mockReturnValue('formatted log output');
  });

  it('renders connectivity log entries when visible', async () => {
    await render(<LogViewer visible onClose={jest.fn()} />);
    expect(screen.getByText('Logged in')).toBeTruthy();
    expect(screen.getByText('Request failed')).toBeTruthy();
    expect(screen.getByText('AUTH')).toBeTruthy();
    expect(screen.getByText('HTTP')).toBeTruthy();
  });

  it('shows the empty state when there are no entries', async () => {
    mockGetConnectivityLog.mockReturnValue([]);
    await render(<LogViewer visible onClose={jest.fn()} />);
    expect(screen.getByText('screens.settings.noLogsAvailable')).toBeTruthy();
    expect(screen.queryByText('Logged in')).toBeNull();
  });

  it('calls clearConnectivityLog and empties the list when Clear is pressed', async () => {
    await render(<LogViewer visible onClose={jest.fn()} />);
    expect(screen.getByText('Logged in')).toBeTruthy();

    await fireEvent.press(screen.getByText('screens.settings.clearLogs'));

    expect(mockClearConnectivityLog).toHaveBeenCalled();
    expect(screen.queryByText('Logged in')).toBeNull();
    expect(screen.getByText('screens.settings.noLogsAvailable')).toBeTruthy();
  });

  it('copies the formatted log to the clipboard when Copy is pressed', async () => {
    await render(<LogViewer visible onClose={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('common.copy'));

    expect(mockFormatConnectivityLog).toHaveBeenCalled();
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('formatted log output');
    expect(mockShowToast).toHaveBeenCalledWith('toast.connectivityLogCopied', 'success');
  });

  it('shows an error toast when copying fails', async () => {
    (Clipboard.setStringAsync as jest.Mock).mockRejectedValueOnce(new Error('fail'));
    await render(<LogViewer visible onClose={jest.fn()} />);

    await fireEvent.press(screen.getByLabelText('common.copy'));

    expect(mockShowToast).toHaveBeenCalledWith('errors.failedToCopyLog', 'error');
  });

  it('calls onClose when the close button is tapped', async () => {
    const onClose = jest.fn();
    await render(<LogViewer visible onClose={onClose} />);

    await fireEvent.press(screen.getByLabelText('common.close'));

    expect(onClose).toHaveBeenCalled();
  });
});
