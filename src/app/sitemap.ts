import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.VERCEL_ENV === 'production' 
    ? 'https://ucucu.vercel.app' 
    : 'http://localhost:3000'

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    // Don't include dynamic room URLs for privacy
    // Individual chat rooms should not be indexed by search engines
  ]
}
