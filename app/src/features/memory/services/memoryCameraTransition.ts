import { haversineM } from '../../../utils/geo';

export function memoryCameraAtTarget(
  target: [number, number],
  renderedCenter: [number, number],
): boolean {
  return haversineM(
    { lat: target[1], lng: target[0] },
    { lat: renderedCenter[1], lng: renderedCenter[0] },
  ) <= 150;
}
