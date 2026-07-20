/**
 * useOnlineOnly — v422 hook for D 类 (纯在线) 功能。
 *
 * 用途:
 *   Marker edit/delete/hide, Session delete, Route CRUD, Memory subscription,
 *   Friends, Auth —— 这些功能户外无触发需求, 无网时应明确禁用按钮 +
 *   给用户看到 "Needs internet" 而不是假装能做然后 fetch 失败。
 *
 * 用法:
 *   const { online, reason } = useOnlineOnly();
 *   <TouchableOpacity disabled={!online} onPress={...}>
 *     <Text>{online ? 'Save' : 'Needs internet'}</Text>
 *   </TouchableOpacity>
 */
import { useEffect, useState } from 'react';
import networkMonitor from '../services/networkMonitor';

export interface OnlineOnlyResult {
  online: boolean;
  /** 无网时的 UI hint 文案。可传给 button label 或 tooltip。 */
  reason: string | null;
}

export function useOnlineOnly(): OnlineOnlyResult {
  const initial = networkMonitor.getState();
  const [online, setOnline] = useState<boolean>(initial ? initial.state === 'online' : true);

  useEffect(() => {
    // 挂载时同步一次 (getState 可能未初始化)
    const s = networkMonitor.getState();
    if (s) setOnline(s.state === 'online');
    const off = networkMonitor.onChange((next) => {
      setOnline(next.state === 'online');
    });
    return () => { off(); };
  }, []);

  return {
    online,
    reason: online ? null : 'Needs internet',
  };
}

export default useOnlineOnly;
