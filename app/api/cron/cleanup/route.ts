import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get current date
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() // 0-indexed (0 = January, 11 = December)

    // Check if we should start cleaning (from December 2025 onwards)
    if (currentYear < 2025 || (currentYear === 2025 && currentMonth < 11)) {
      console.log('[v0] Cleanup skipped - will start from December 2025')
      return NextResponse.json({ 
        message: 'Cleanup not yet active - will start from December 2025',
        skipped: true 
      })
    }

    // Calculate previous month
    let previousMonth = currentMonth - 1
    let previousYear = currentYear

    if (previousMonth < 0) {
      previousMonth = 11 // December
      previousYear = currentYear - 1
    }

    // Create date range for previous month
    const startDate = new Date(previousYear, previousMonth, 1)
    const endDate = new Date(previousYear, previousMonth + 1, 0) // Last day of previous month

    // Format dates as YYYY-MM-DD
    const startDateStr = `${previousYear}-${String(previousMonth + 1).padStart(2, '0')}-01`
    const endDateStr = `${previousYear}-${String(previousMonth + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`

    console.log('[v0] Cleaning up data from', startDateStr, 'to', endDateStr)

    // Delete records from previous month
    const { data, error, count } = await supabase
      .from('turni')
      .delete({ count: 'exact' })
      .gte('data', startDateStr)
      .lte('data', endDateStr)

    if (error) {
      console.error('[v0] Cleanup error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    console.log('[v0] Cleanup completed. Deleted', count, 'records')

    return NextResponse.json({
      success: true,
      message: `Deleted ${count} records from ${startDateStr} to ${endDateStr}`,
      deletedCount: count,
      period: {
        start: startDateStr,
        end: endDateStr
      }
    })
  } catch (error: any) {
    console.error('[v0] Cleanup failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
