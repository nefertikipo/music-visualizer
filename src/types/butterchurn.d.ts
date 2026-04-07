declare module "butterchurn" {
  interface ButterchurnVisualizer {
    connectAudio(audioNode: AudioNode): void;
    loadPreset(preset: unknown, blendTime: number): void;
    setRendererSize(width: number, height: number): void;
    render(): void;
  }

  interface ButterchurnStatic {
    createVisualizer(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      options?: {
        width?: number;
        height?: number;
        pixelRatio?: number;
        textureRatio?: number;
      }
    ): ButterchurnVisualizer;
  }

  const butterchurn: ButterchurnStatic;
  export default butterchurn;
}

declare module "butterchurn-presets" {
  const presets: Record<string, unknown>;
  export default presets;
}
