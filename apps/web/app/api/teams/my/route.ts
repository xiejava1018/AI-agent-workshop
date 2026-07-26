import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get('x-user-id')
  if (!userId) return NextResponse.json({ error: 'auth required' }, { status: 401 })

  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    select: { role: true, team: { select: { id: true, name: true } } },
    orderBy: { team: { name: 'asc' } }
  })

  return NextResponse.json({
    teams: memberships.map(({ team, role }) => ({ id: team.id, name: team.name, role }))
  })
}
