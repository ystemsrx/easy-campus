export interface FloorRoom {
  floor?: string;
  building?: {
    id?: string;
    name?: string;
  };
}

export interface FloorRoomGroup<T extends FloorRoom> {
  id: string;
  label: string;
  rooms: T[];
}

interface FloorDescriptor {
  id: string;
  label: string;
  order: number;
}

function floorDescriptor(value?: string): FloorDescriptor {
  const compact = String(value || "")
    .trim()
    .replace(/\s+/g, "");
  if (!compact) {
    return { id: "floor-unknown", label: "楼层未提供", order: 200_000 };
  }

  const basement = /^B(\d+)(?:层|楼)?$/i.exec(compact);
  if (basement) {
    const level = Number(basement[1]);
    return {
      id: `floor-b${level}`,
      label: `B${level} 层`,
      order: -level,
    };
  }

  const numeric = /^(-?\d+)(?:层|楼)?$/.exec(compact);
  if (numeric) {
    const level = Number(numeric[1]);
    return {
      id: `floor-${level}`,
      label: `${level} 层`,
      order: level,
    };
  }

  const normalized = compact.replace(/楼$/, "层");
  return {
    id: `floor-${normalized}`,
    label: /层$/.test(normalized) ? normalized : `${normalized} 层`,
    order: 100_000,
  };
}

export function groupRoomsByFloor<T extends FloorRoom>(
  rooms: T[],
): FloorRoomGroup<T>[] {
  const groups = new Map<
    string,
    FloorRoomGroup<T> & {
      buildingOrder: number;
      floorOrder: number;
      sequence: number;
    }
  >();
  const buildingOrders = new Map<string, number>();

  rooms.forEach((room, sequence) => {
    const floor = floorDescriptor(room.floor);
    const buildingLabel = String(room.building?.name || "").trim();
    const buildingKey = String(
      room.building?.id || buildingLabel || "building-unknown",
    );
    if (!buildingOrders.has(buildingKey)) {
      buildingOrders.set(buildingKey, buildingOrders.size);
    }
    const id = `${buildingKey}-${floor.id}`;
    const existing = groups.get(id);
    if (existing) {
      existing.rooms.push(room);
      return;
    }
    groups.set(id, {
      id,
      label: [buildingLabel, floor.label].filter(Boolean).join(" · "),
      rooms: [room],
      buildingOrder: buildingOrders.get(buildingKey) || 0,
      floorOrder: floor.order,
      sequence,
    });
  });

  return [...groups.values()]
    .sort(
      (left, right) =>
        left.buildingOrder - right.buildingOrder ||
        left.floorOrder - right.floorOrder ||
        left.sequence - right.sequence,
    )
    .map(({ id, label, rooms: groupedRooms }) => ({
      id,
      label,
      rooms: groupedRooms,
    }));
}
