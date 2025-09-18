'use client'

import React from 'react'
import Link from 'next/link'
import { AnimatedPortal } from '@/components/ui/animated-portal'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  ArrowRight, 
  Zap, 
  Shield, 
  Layers, 
  Globe, 
  Sparkles,
  Bot,
  Server,
  Network,
  CheckCircle
} from 'lucide-react'

export default function LandingPage() {
  const features = [
    {
      icon: Bot,
      title: 'Multi-Agent Support',
      description: 'Connect Claude, Cursor, Kiro, and any MCP-compatible agent to your portal',
      gradient: 'from-blue-500 to-cyan-500'
    },
    {
      icon: Layers,
      title: 'Stack Management',
      description: 'Organize MCP servers into dedicated stacks for each agent',
      gradient: 'from-purple-500 to-pink-500'
    },
    {
      icon: Shield,
      title: 'Secure & Isolated',
      description: 'Each agent gets its own secure endpoint with API key authentication',
      gradient: 'from-green-500 to-emerald-500'
    },
    {
      icon: Globe,
      title: 'Remote Access',
      description: 'Access your MCP servers from anywhere, no local setup required',
      gradient: 'from-amber-500 to-orange-500'
    },
    {
      icon: Zap,
      title: 'Instant Deployment',
      description: 'Deploy MCP servers in seconds from Smithery.ai or GitHub',
      gradient: 'from-red-500 to-rose-500'
    },
    {
      icon: Sparkles,
      title: 'Visual Management',
      description: 'Beautiful React Flow interface for managing connections',
      gradient: 'from-indigo-500 to-blue-500'
    }
  ]

  const plans = [
    {
      name: 'Starter',
      price: '$15',
      description: 'Perfect for individuals',
      features: [
        'Up to 5 agents',
        '15 MCP servers',
        '2GB RAM / 1 CPU',
        'Community support',
        '7-day free trial'
      ],
      cta: 'Start Free Trial',
      popular: false
    },
    {
      name: 'Pro',
      price: '$40',
      description: 'For power users',
      features: [
        'Up to 15 agents',
        '50 MCP servers',
        '8GB RAM / 4 CPU',
        'Priority support',
        'Advanced analytics',
        'API access'
      ],
      cta: 'Go Pro',
      popular: true
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      description: 'For organizations',
      features: [
        'Unlimited agents',
        'Unlimited MCPs',
        'Custom resources',
        'SLA guarantees',
        'SSO integration',
        'Dedicated support'
      ],
      cta: 'Contact Sales',
      popular: false
    }
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 via-transparent to-cyan-500/5" />
        <div className="absolute inset-0 bg-grid opacity-5" />
        
        <div className="container-custom relative py-24 lg:py-32">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left side - Content */}
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-primary">Remote MCP Hosting Platform</span>
              </div>
              
              <h1 className="text-5xl lg:text-6xl font-bold leading-tight">
                The Ultimate{' '}
                <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                  MCP Portal
                </span>{' '}
                for AI Agents
              </h1>
              
              <p className="text-xl text-muted-foreground">
                Connect your Claude, Cursor, and other AI agents to centrally managed MCP servers. 
                No local setup required - access your tools from anywhere.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Link href="/dashboard">
                  <Button size="lg" variant="glow" className="gap-2">
                    Open Dashboard
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline">
                  View Documentation
                </Button>
              </div>
              
              <div className="flex items-center gap-6 pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">7-day free trial</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span className="text-sm text-muted-foreground">No credit card required</span>
                </div>
              </div>
            </div>
            
            {/* Right side - Portal Animation */}
            <div className="flex justify-center lg:justify-end">
              <AnimatedPortal size={500} />
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-card/30">
        <div className="container-custom">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">
              Everything You Need for{' '}
              <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
                MCP Management
              </span>
            </h2>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              A complete platform for hosting, managing, and connecting MCP servers to your AI agents
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card 
                key={index}
                className="group hover:shadow-xl transition-all duration-300 border-border/50 hover:border-primary/30"
              >
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} p-2.5 mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <feature.icon className="w-full h-full text-white" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-24">
        <div className="container-custom">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-xl text-muted-foreground">Get started in three simple steps</p>
          </div>
          
          <div className="grid lg:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Register Your Agents',
                description: 'Add your Claude Desktop, Cursor, or other MCP-compatible agents to the portal',
                icon: Bot
              },
              {
                step: '02',
                title: 'Create MCP Stacks',
                description: 'Import MCP servers from Smithery.ai or GitHub and organize them into stacks',
                icon: Server
              },
              {
                step: '03',
                title: 'Connect & Use',
                description: 'Get unique endpoints for each agent and start using your MCP tools remotely',
                icon: Network
              }
            ].map((item, index) => (
              <div key={index} className="relative">
                {index < 2 && (
                  <div className="hidden lg:block absolute top-1/4 -right-4 w-8 text-muted-foreground">
                    <ArrowRight className="w-full h-full" />
                  </div>
                )}
                <Card className="h-full hover:shadow-lg transition-shadow duration-300">
                  <CardContent className="p-6 text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
                      <span className="text-2xl font-bold text-primary">{item.step}</span>
                    </div>
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 p-2.5 mx-auto mb-4">
                      <item.icon className="w-full h-full text-white" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                    <p className="text-muted-foreground">{item.description}</p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-24 bg-card/30">
        <div className="container-custom">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold mb-4">Simple, Transparent Pricing</h2>
            <p className="text-xl text-muted-foreground">Choose the plan that fits your needs</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {plans.map((plan, index) => (
              <Card 
                key={index}
                className={`relative ${plan.popular ? 'border-primary shadow-xl scale-105' : 'border-border'}`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 bg-primary text-primary-foreground text-xs font-semibold rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                <CardContent className="p-6">
                  <div className="text-center mb-6">
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    <div className="flex items-baseline justify-center gap-1 mb-2">
                      <span className="text-4xl font-bold">{plan.price}</span>
                      {plan.price !== 'Custom' && <span className="text-muted-foreground">/month</span>}
                    </div>
                    <p className="text-muted-foreground">{plan.description}</p>
                  </div>
                  
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <Button 
                    className="w-full" 
                    variant={plan.popular ? 'glow' : 'outline'}
                  >
                    {plan.cta}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="container-custom">
          <Card className="overflow-hidden bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border-primary/20">
            <CardContent className="p-12 text-center">
              <h2 className="text-4xl font-bold mb-4">
                Ready to Transform Your MCP Workflow?
              </h2>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Join thousands of developers using MCP Portal to manage their AI agent infrastructure
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/dashboard">
                  <Button size="lg" variant="glow" className="gap-2">
                    Get Started Free
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Button size="lg" variant="outline">
                  Schedule Demo
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  )
}
