import type { Segment } from './pieces'

export type Bus = {
  agentId: string
  rooms: readonly string[]
  unread: number | null
}

export type WhoamiView = { bound?: boolean; agentId?: string; rooms?: string[]; inboxUnread?: number }

export type McpBlock = { type: string; text?: string }

export const parseJsonBlock = <T,>(content: readonly McpBlock[], isError: boolean) => {
  const block = content[0]

  return isError || block?.type !== 'text' || !block.text ? null : (JSON.parse(block.text) as T)
}

const roleLabel = (role: unknown) => {
  if (typeof role === 'string') {
    return role
  }

  if (role && typeof role === 'object') {
    const { displayName, roleId } = role as { displayName?: unknown; roleId?: unknown }

    return typeof displayName === 'string' ? displayName : typeof roleId === 'string' ? roleId : undefined
  }

  return undefined
}

type JoinCall = { agentId: string; role?: string }

/** The seat this transcript last joined the bus as, or null if it never did or has since unregistered. */
export const findJoin = (messages: readonly { content?: unknown }[]): JoinCall | null => {
  let seat: JoinCall | null = null

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue
    }

    for (const block of message.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (block?.type !== 'tool_use') {
        continue
      }

      if (block.name === 'mcp__agent-coord__join' && typeof block.input?.agentId === 'string') {
        seat = { agentId: block.input.agentId, role: roleLabel(block.input.role) }
      } else if (block.name === 'mcp__agent-coord__unregister') {
        seat = null
      }
    }
  }

  return seat
}

export const busLine = (bus: Bus) =>
  [
    bus.agentId,
    bus.rooms.map(room => `#${room}`).join(' ') || 'no room',
    bus.unread === null ? null : bus.unread === 0 ? 'inbox clear' : `${bus.unread} unread`,
  ]
    .filter(Boolean)
    .join(' · ')

export const busSegment = (bus: Bus): Segment => {
  const rooms = bus.rooms.map(room => `#${room}`).join(' ')
  const unread = bus.unread ? ` ✉${bus.unread}` : ''

  return {
    long: [{ text: '●', color: 'success' }, { text: ` bus: ${busLine(bus)}`, dim: true }],
    short: [{ text: '●', color: 'success' }, { text: ` ${bus.agentId}${rooms ? ` ${rooms}` : ''}${unread}`, dim: true }],
  }
}
