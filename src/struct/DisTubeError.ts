export class DisTubeError extends Error {
  constructor(message: string, name = "DisTubeError") {
    super(message);
    Error?.captureStackTrace(this, DisTubeError);
    this.name = name;
  }
}
