import { type NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('SetupThemeRoute');

const BACKEND_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'
).replace('localhost', '127.0.0.1');

interface SetupThemeRequest {
  appName: string;
  claudeMd: string;
  basePath?: string;
  description?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SetupThemeRequest = await request.json();
    const { appName, claudeMd, basePath, description } = body;

    if (!appName || !claudeMd) {
      return NextResponse.json(
        { success: false, error: 'アプリ名とCLAUDE.mdの内容は必須です' },
        { status: 400 },
      );
    }

    logger.info('Setting up theme for app:', appName);

    // Proxy request to backend
    const response = await fetch(`${BACKEND_URL}/themes/setup-from-claude-md`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appName,
        claudeMd,
        basePath,
        description,
      }),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error('Backend setup-theme failed:', data);
      return NextResponse.json(
        {
          success: false,
          error: data.message || 'テーマの作成に失敗しました',
        },
        { status: response.status },
      );
    }

    logger.info('Theme setup successful:', data);
    return NextResponse.json(data);
  } catch (error) {
    logger.error('Error in setup-theme route:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'テーマの作成に失敗しました',
      },
      { status: 500 },
    );
  }
}
