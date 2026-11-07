import type { Vec3 } from './math';

export interface TerrainBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface TerrainSampler {
  readonly bounds: TerrainBounds
  heightAt(x: number, z: number): number          // metres ASL; returns 0 (sea) outside bounds
  normalAt(x: number, z: number): Vec3            // unit, Y up
  isReady(): boolean
}
