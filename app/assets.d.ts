// Asset module declarations for Metro asset imports.
// Lets TypeScript accept `import x from '....ttf'` without complaint.
declare module '*.ttf' {
  const value: number;
  export default value;
}
declare module '*.otf' {
  const value: number;
  export default value;
}
declare module '*.png' {
  const value: number;
  export default value;
}
declare module '*.jpg' {
  const value: number;
  export default value;
}
declare module '*.svg' {
  const value: number;
  export default value;
}
