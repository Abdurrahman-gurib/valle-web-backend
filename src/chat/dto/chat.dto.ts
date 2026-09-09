import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsSafeText, isSuppliedValue } from '../../common/validation';

/**
 * Opaque id the widget keeps in localStorage. It is the visitor's only
 * credential, so the shape is pinned: lowercase, digits and dashes only.
 */
export const VISITOR_KEY_PATTERN = /^[a-z0-9-]{8,64}$/;

export const MESSAGE_MAX_LENGTH = 2000;

const trimmed = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

// --------------------------------------------------------------- REST payloads

export class StartSessionDto {
  @ApiProperty({ example: 'v-8f3c21ab9de0', pattern: VISITOR_KEY_PATTERN.source })
  @IsString()
  @Matches(VISITOR_KEY_PATTERN, {
    message: 'visitorKey must be 8-64 characters of a-z, 0-9 or -',
  })
  visitorKey: string;

  @ApiPropertyOptional({ example: 'A. Peirce', maxLength: 120 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'guest@example.com', maxLength: 160 })
  @IsOptional()
  @Transform(trimmed)
  // The widget sends an empty string for "not filled in yet", so only a
  // non-empty value has to look like an address. The predicate must not read
  // `.length` off the raw value: a payload such as `{"email":{"length":1}}`
  // would then steer the validators with an object. Anything that is not
  // undefined, null or '' stays inside the validated branch, where @IsString()
  // rejects a non-string with a 400.
  @ValidateIf((dto: StartSessionDto) => isSuppliedValue(dto.email))
  @IsString()
  @IsSafeText()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}

export class VisitorKeyQueryDto {
  @ApiProperty({ example: 'v-8f3c21ab9de0', pattern: VISITOR_KEY_PATTERN.source })
  @IsString()
  @Matches(VISITOR_KEY_PATTERN, {
    message: 'visitorKey must be 8-64 characters of a-z, 0-9 or -',
  })
  visitorKey: string;
}

export class PostVisitorMessageDto {
  @ApiProperty({ example: 'v-8f3c21ab9de0', pattern: VISITOR_KEY_PATTERN.source })
  @IsString()
  @Matches(VISITOR_KEY_PATTERN, {
    message: 'visitorKey must be 8-64 characters of a-z, 0-9 or -',
  })
  visitorKey: string;

  @ApiProperty({ example: 'Is the zipline open on Sunday?', maxLength: MESSAGE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;
}

export class StaffConversationsQueryDto {
  @ApiPropertyOptional({ enum: ['open', 'closed'] })
  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

export class PostStaffMessageDto {
  @ApiProperty({ example: 'Yes, every day, 09:00 to 17:30.', maxLength: MESSAGE_MAX_LENGTH })
  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;
}

// ------------------------------------------------------------ socket payloads
// Socket handlers bypass the global ValidationPipe (it only runs on HTTP), so
// the gateway validates these by hand: same classes, same rules.

export class SocketConversationDto {
  @IsUUID()
  conversationId: string;
}

export class SocketMessageDto {
  @IsUUID()
  conversationId: string;

  @Transform(trimmed)
  @IsString()
  @IsSafeText()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX_LENGTH)
  body: string;
}
