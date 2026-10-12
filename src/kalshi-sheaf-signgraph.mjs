/**
 * Venue-specific presentation of the upstream SignGraph weighted cellular
 * sheaf. This is an ADAPTER, not a second Laplacian, sheaf, solver or graph.
 *
 * The market supplies learned restriction pairs Fu/Fv and an inverse-residual-
 * covariance edge metric W. SignGraph owns δ, δᵀWδ and edge Dirichlet energy.
 * The existing Kalshi harmonic partial-identification solver consumes the
 * resulting dense numerical L; mathematical sheaf ownership stays upstream.
 */
import {
  cellularSheaf,weightedSheafLaplacian,weightedSheafDirichlet,
  coboundary as signGraphCoboundary,apply as applySparse,
} from '@red-cup-engineering/signgraph/cellular-sheaf';

export function buildMarketSheafFromSignGraph(vertices,edges){
  const core=cellularSheaf({
    vertices,
    edges:edges.map(e=>({
      id:e.id,from:e.u,to:e.v,dim:e.Fu.length,
      restrict:{from:e.Fu,to:e.Fv},
    })),
  });
  const metrics=edges.map(e=>e.W);
  const laplacian=weightedSheafLaplacian(core,metrics);
  const L=Array.from({length:core.c0},()=>new Array(core.c0).fill(0));
  for(let i=0;i<laplacian.rows;i++)
    for(const [j,value] of laplacian.entries[i])L[i][j]=value;
  const offset=new Map(vertices.map((v,i)=>[v.id,core.vertexOffsets[i]]));
  return {vertices,edges,offset,n:core.c0,L,coreSheaf:core};
}

/** Native coboundary, regrouped by the Kalshi edge-stalk presentation. */
export function marketSheafCoboundary(sheaf,x){
  const native=sheaf.coreSheaf;
  if(!native)throw new TypeError('the market sheaf must be formed from SignGraph');
  const residual=applySparse(signGraphCoboundary(native),x);
  return native.edges.map((edge,i)=>
    residual.slice(native.edgeOffsets[i],native.edgeOffsets[i]+edge.dim));
}

/** Native weighted energy; Kalshi retains only its station/event labels. */
export function marketSheafDirichlet(sheaf,x){
  const core=sheaf.coreSheaf;
  if(!core)throw new TypeError('the market sheaf must be formed from SignGraph');
  const native=weightedSheafDirichlet(core,sheaf.edges.map(e=>e.W),x);
  return {
    energy:native.energy,
    perEdge:native.perEdge.map((e,i)=>({
      id:e.id,u:sheaf.edges[i].u,v:sheaf.edges[i].v,
      energy:e.energy,residual:e.residual,
    })),
  };
}

/** Tension is a reading of the same weighted edge energy, not another fit. */
export function marketSheafVertexTension(sheaf,x){
  const tension=new Map(sheaf.vertices.map(v=>[v.id,0]));
  for(const e of marketSheafDirichlet(sheaf,x).perEdge){
    tension.set(e.u,tension.get(e.u)+e.energy/2);
    tension.set(e.v,tension.get(e.v)+e.energy/2);
  }
  return tension;
}
