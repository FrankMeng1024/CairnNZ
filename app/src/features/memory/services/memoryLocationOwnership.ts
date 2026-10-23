export function memoryUserLocationShouldMount(input: {
  coordinateAvailable: boolean;
  screenFocused: boolean;
  appActive: boolean;
}): boolean {
  return input.coordinateAvailable && input.screenFocused && input.appActive;
}
