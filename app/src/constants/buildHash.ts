/**
 * buildHash — 内部标识符，用于区分 OTA bundle 具体是哪个 build。
 *
 * 每次 OTA 前手动更新（用当前 git HEAD 短 hash + 时间戳）。
 * 用户看到的版本号是 OTA_VERSION（O18/O19/...），一次 OTA 必须 +1；
 * 但同一 O 版本号如果 rebuild 多次，需要靠 BUILD_HASH 区分实际 bundle。
 *
 * 用途：
 *   - crashLogger 上传时带在 header (X-Cairn-Build-Hash)
 *   - boot-ok upload 时也带
 *   - aliyun 查 telemetry_sessions 时能确认用户装的是不是最新推的 bundle
 *
 * 更新流程（每次推 OTA 前）：
 *   1. git rev-parse --short HEAD → 拿短 hash
 *   2. 当前时间 → YYYYMMDD-HHmm
 *   3. 拼成 `${date}-${hash}` 替换下面 BUILD_HASH
 *   4. commit + eas update
 */
export const BUILD_HASH = '20260805-2340-85d8a22';
