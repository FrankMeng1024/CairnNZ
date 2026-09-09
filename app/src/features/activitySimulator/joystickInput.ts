export const SIMULATOR_JOYSTICK_SIZE = 116;
export const SIMULATOR_JOYSTICK_TRAVEL = 38;

export interface SimulatorJoystickVector {
  x: number;
  y: number;
  bearingDegrees: number;
  magnitude: number;
}

/**
 * Native touch coordinates are local to the joystick surface. Derive input
 * from that fixed centre so an edge press starts full-speed movement even
 * before the finger drags; gesture dx/dy would incorrectly use the touch-down
 * point as zero and make a held press stationary.
 */
export function joystickVectorFromLocalPoint(
  locationX: number,
  locationY: number,
  size = SIMULATOR_JOYSTICK_SIZE,
  travel = SIMULATOR_JOYSTICK_TRAVEL,
): SimulatorJoystickVector {
  const rawX = locationX - size / 2;
  const rawY = locationY - size / 2;
  const distance = Math.sqrt(rawX ** 2 + rawY ** 2);
  const scale = distance > travel ? travel / distance : 1;
  const x = rawX * scale;
  const y = rawY * scale;
  return {
    x,
    y,
    bearingDegrees: ((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360,
    magnitude: Math.min(1, distance / travel),
  };
}
