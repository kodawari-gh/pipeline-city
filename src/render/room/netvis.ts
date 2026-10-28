/** The level that unlocks the network (docs/NETWORK.md): the router spot and the wall plate must be there to buy from. */
export const NET_UNLOCK_LEVEL = 4;

export interface NetVisInput {
  level: number;
  hasRouter: boolean;
  hasIsp: boolean;
  routerInInventory: boolean;
  lanConnected: boolean;
}

/** Whether the network props (router spot, wall plate, jacks) are drawn: from the unlock level, or once any network part exists. */
export const netPropsVisible = (i: NetVisInput): boolean =>
  i.level >= NET_UNLOCK_LEVEL || i.hasRouter || i.hasIsp || i.routerInInventory || i.lanConnected;
