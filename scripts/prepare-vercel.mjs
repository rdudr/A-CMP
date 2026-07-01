import fs from 'fs';
import path from 'path';

const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
try {
  let content = fs.readFileSync(schemaPath, 'utf8');
  if (content.includes('provider  = "sqlite"')) {
    content = content.replace('provider  = "sqlite"', 'provider  = "postgresql"');
    fs.writeFileSync(schemaPath, content);
    console.log('✅ Updated prisma/schema.prisma to use PostgreSQL for Vercel deployment.');
  } else {
    console.log('ℹ️ prisma/schema.prisma already configured for PostgreSQL or no sqlite provider found.');
  }
} catch (error) {
  console.error('Failed to update schema.prisma:', error);
}
