import { Column, DataType, Model, Table } from 'sequelize-typescript';

export type EmailCodePurpose = 'register' | 'login' | 'reset_password';

@Table({
  tableName: 'email_verification_codes',
  timestamps: true,
  updatedAt: false,
})
export class EmailVerificationCode extends Model<EmailVerificationCode> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare email: string;

  @Column({
    type: DataType.ENUM('register', 'login', 'reset_password'),
    allowNull: false,
  })
  declare purpose: EmailCodePurpose;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare codeHash: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare expiresAt: Date;
}
