'use client';

/**
 * RapiFloatRoute
 *
 * The route ラピ's own desktop window loads (`rapi_float.rs`): a transparent
 * page laid over the main window with only her on it (#1535).
 */
import { RapiFloatPage } from '@/components/rapi-avatar/float';
import { RapiAvatarResident } from '@/components/rapi-avatar/RapiAvatarHost';

export default function RapiFloatRoute() {
  return (
    <RapiFloatPage>
      <RapiAvatarResident />
    </RapiFloatPage>
  );
}
